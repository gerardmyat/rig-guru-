"""
Lightweight local RAG: JSONL corpus under ``backend/rag_data/`` + Gemini embeddings + cosine search.
"""
from __future__ import annotations

import json
import logging
import math
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from rig_guru.env import backend_dir, load_backend_dotenv

load_backend_dotenv()

logger = logging.getLogger(__name__)

RAG_DATA_DIR = Path(os.getenv("RAG_DATA_DIR", str(backend_dir() / "rag_data")))
CORPUS_PATH = RAG_DATA_DIR / "corpus.jsonl"

# v1beta often rejects legacy ids like text-embedding-004; prefer current Gemini embedding names.
_DEFAULT_EMBEDDING_MODELS = "gemini-embedding-001,gemini-embedding-2-preview,text-embedding-004"

_lock = threading.Lock()
# First successful model in this process (ingest + query must use the same vectors).
_resolved_embedding_model: Optional[str] = None
_cache_mtime: Optional[float] = None
_cache_rows: List[Dict[str, Any]] = []


def _api_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip().strip(
        '"'
    ).strip("'")


def _embedding_model_candidates() -> List[str]:
    """Try user env first, then built-in fallbacks (so old `text-embedding-004` in .env still works)."""
    seen: set[str] = set()
    ordered: List[str] = []
    for raw in (
        os.getenv("GEMINI_EMBEDDING_MODELS"),
        os.getenv("GEMINI_EMBEDDING_MODEL"),
        _DEFAULT_EMBEDDING_MODELS,
    ):
        if not raw:
            continue
        for p in raw.split(","):
            m = p.strip()
            if m and m not in seen:
                seen.add(m)
                ordered.append(m)
    return ordered or ["gemini-embedding-001"]


def _embed_texts_sync(texts: List[str]) -> List[List[float]]:
    if not texts:
        return []
    key = _api_key()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is required for RAG embeddings.")

    global _resolved_embedding_model

    from google import genai

    client = genai.Client(api_key=key)
    to_try = (
        [_resolved_embedding_model] if _resolved_embedding_model else _embedding_model_candidates()
    )

    last_err: Optional[Exception] = None
    for model in to_try:
        try:
            resp = client.models.embed_content(model=model, contents=texts)
            out: List[List[float]] = []
            for emb in resp.embeddings or []:
                vals = emb.values if emb and emb.values is not None else []
                out.append(list(vals))
            if len(out) != len(texts):
                raise RuntimeError("Embedding API returned unexpected number of vectors.")
            if not _resolved_embedding_model:
                _resolved_embedding_model = model
                logger.info("RAG using embedding model: %s", model)
            return out
        except Exception as exc:
            last_err = exc
            logger.warning("embed_content failed for model %r: %s", model, exc)
            if _resolved_embedding_model:
                raise
            continue
    raise RuntimeError(
        "No embedding model worked. Set GEMINI_EMBEDDING_MODEL to a model your key supports "
        "(see https://ai.google.dev/gemini-api/docs/embeddings ). Last error: "
        + (str(last_err) if last_err else "unknown")
    )


def _cosine(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _load_corpus_unlocked() -> List[Dict[str, Any]]:
    global _cache_rows, _cache_mtime
    if not CORPUS_PATH.is_file():
        _cache_rows = []
        _cache_mtime = None
        return _cache_rows
    mtime = CORPUS_PATH.stat().st_mtime
    if _cache_mtime == mtime and _cache_rows:
        return _cache_rows
    rows: List[Dict[str, Any]] = []
    with CORPUS_PATH.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    _cache_rows = rows
    _cache_mtime = mtime
    return _cache_rows


def corpus_count() -> int:
    with _lock:
        return len(_load_corpus_unlocked())


def append_chunks(chunks: List[Dict[str, Any]]) -> int:
    if not chunks:
        return 0
    RAG_DATA_DIR.mkdir(parents=True, exist_ok=True)

    texts = [c["text"] for c in chunks]
    vectors = _embed_texts_sync(texts)

    written = 0
    with _lock:
        existing_ids = {row["id"] for row in _load_corpus_unlocked()}
        lines_out: List[str] = []
        for chunk, vec in zip(chunks, vectors):
            cid = chunk["id"]
            if cid in existing_ids:
                continue
            row = {
                "id": cid,
                "source_url": chunk.get("source_url", ""),
                "title": chunk.get("title", ""),
                "text": chunk["text"],
                "embedding": vec,
            }
            lines_out.append(json.dumps(row, ensure_ascii=False))
            existing_ids.add(cid)
            written += 1

        if lines_out:
            with CORPUS_PATH.open("a", encoding="utf-8") as f:
                for ln in lines_out:
                    f.write(ln + "\n")
        _cache_mtime = None
        _load_corpus_unlocked()

    return written


def retrieve_context(query: str, top_k: int = 6) -> str:
    query = (query or "").strip()
    if not query:
        return ""

    with _lock:
        rows = list(_load_corpus_unlocked())
    if not rows:
        return ""

    try:
        qvec = _embed_texts_sync([query])[0]
    except Exception as exc:
        logger.warning("RAG query embedding failed: %s", exc)
        return ""

    scored: List[Tuple[float, Dict[str, Any]]] = []
    for row in rows:
        emb = row.get("embedding")
        if not isinstance(emb, list) or not emb:
            continue
        if len(emb) != len(qvec):
            # Corpus was built with a different embedding model — re-ingest after changing model.
            continue
        scored.append((_cosine(qvec, emb), row))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[: max(1, top_k)]

    parts: List[str] = []
    for rank, (score, row) in enumerate(top, start=1):
        if score <= 0:
            continue
        src = row.get("source_url") or "unknown source"
        title = row.get("title") or "Untitled"
        body = (row.get("text") or "").strip()
        if not body:
            continue
        parts.append(f"[{rank}] Source: {src}\nTitle: {title}\nExcerpt:\n{body}\n")
    if not parts:
        return ""
    return (
        "Use the following retrieved excerpts as reference material. "
        "Synthesize with your own expertise; do not copy verbatim. "
        "If an excerpt conflicts with current facts, prefer cautious language.\n\n"
        + "\n---\n".join(parts)
    )
