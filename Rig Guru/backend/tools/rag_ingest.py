"""
Ingest content into the local RAG corpus (``backend/rag_data/corpus.jsonl``).

Run from ``backend``:

  python -m tools.rag_ingest https://example.com/article
  python -m tools.rag_ingest --file samples/knowledge_urls.sample.txt
  python -m tools.rag_ingest --pdf samples/rag_pdfs/guide.pdf
  python -m tools.rag_ingest --text-file notes/hardware-policy.txt
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path
from typing import List
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from rig_guru.env import load_backend_dotenv
from rig_guru.services.rag_store import append_chunks

load_backend_dotenv()


def _visible_text_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines)


def fetch_url_text(url: str, timeout: float = 20.0) -> tuple[str, str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; RigGuruBot/1.0; +https://localhost; "
            "enterprise hardware knowledge indexing)"
        )
    }
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        html = response.text
    soup = BeautifulSoup(html, "html.parser")
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    return title, _visible_text_from_html(html)


def chunk_text(text: str, max_chars: int = 1200, overlap: int = 150) -> List[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(0, end - overlap)
    return chunks


def extract_pdf_text(path: Path) -> tuple[str, str]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    title = ""
    meta = reader.metadata
    if meta is not None:
        raw_title = None
        if hasattr(meta, "title") and meta.title:
            raw_title = meta.title
        elif hasattr(meta, "get"):
            raw_title = meta.get("/Title")
        if raw_title:
            title = str(raw_title).strip()
    if not title:
        title = path.stem

    parts: List[str] = []
    for i, page in enumerate(reader.pages):
        try:
            t = page.extract_text()
        except Exception as exc:
            print(f"Warning: page {i + 1} of {path.name}: {exc}", file=sys.stderr)
            continue
        if t and t.strip():
            parts.append(t.strip())
    body = "\n\n".join(parts)
    return title, body


def ingest_url(url: str) -> int:
    title, body = fetch_url_text(url)
    if len(body) < 80:
        print(f"Warning: very little text extracted from {url}", file=sys.stderr)
    parts = chunk_text(body)
    chunks = []
    for i, part in enumerate(parts):
        cid = hashlib.sha256(f"{url}:{i}:{part[:40]}".encode("utf-8")).hexdigest()
        chunks.append(
            {
                "id": cid,
                "source_url": url,
                "title": title or urlparse(url).netloc,
                "text": part,
            }
        )
    n = append_chunks(chunks)
    print(f"Ingested {n} new chunks from {url} (title: {title or 'n/a'})")
    return n


def ingest_pdf(path: Path) -> int:
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")
    title, body = extract_pdf_text(path)
    if len(body) < 80:
        print(
            f"Warning: very little text extracted from {path.name} "
            "(scanned books need OCR; digital PDFs work best).",
            file=sys.stderr,
        )
    source = path.as_uri()
    parts = chunk_text(body)
    chunks = []
    for i, part in enumerate(parts):
        cid = hashlib.sha256(f"{source}:{i}:{part[:40]}".encode("utf-8")).hexdigest()
        chunks.append(
            {
                "id": cid,
                "source_url": source,
                "title": title or path.name,
                "text": part,
            }
        )
    n = append_chunks(chunks)
    print(f"Ingested {n} new chunks from PDF {path} (title: {title or 'n/a'})")
    return n


def ingest_text_file(path: Path) -> int:
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")
    body = path.read_text(encoding="utf-8", errors="replace").strip()
    title = path.stem
    first = body.split("\n", 1)[0].strip() if body else ""
    if first.lower().startswith("title:"):
        title = first.split(":", 1)[1].strip() or title
        body = body.split("\n", 1)[1].strip() if "\n" in body else ""

    if len(body) < 40:
        print(f"Warning: very little text in {path.name}", file=sys.stderr)

    source = path.as_uri()
    parts = chunk_text(body)
    chunks = []
    for i, part in enumerate(parts):
        cid = hashlib.sha256(f"{source}:{i}:{part[:40]}".encode("utf-8")).hexdigest()
        chunks.append(
            {
                "id": cid,
                "source_url": source,
                "title": title,
                "text": part,
            }
        )
    n = append_chunks(chunks)
    print(f"Ingested {n} new chunks from text file {path} (title: {title})")
    return n


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest URLs, PDFs, or text files into Rig Guru RAG corpus."
    )
    parser.add_argument("urls", nargs="*", help="One or more http(s) URLs to ingest")
    parser.add_argument(
        "--file",
        "-f",
        help="Text file with one URL per line (# comments and blank lines ok)",
    )
    parser.add_argument(
        "--pdf",
        action="append",
        default=[],
        metavar="PATH",
        help="Path to a PDF (repeat flag for multiple files)",
    )
    parser.add_argument(
        "--text-file",
        action="append",
        default=[],
        metavar="PATH",
        help="Path to a UTF-8 text file (optional first line: Title: My Doc)",
    )
    args = parser.parse_args()

    urls: List[str] = list(args.urls)
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                urls.append(line)

    pdfs = [Path(p) for p in args.pdf]
    text_files = [Path(p) for p in args.text_file]

    if not urls and not pdfs and not text_files:
        parser.print_help()
        sys.exit(1)

    total = 0

    for u in urls:
        u = u.strip()
        if not u.startswith("http"):
            print(f"Skip (not http URL): {u}", file=sys.stderr)
            continue
        try:
            total += ingest_url(u)
        except Exception as exc:
            print(f"Failed {u}: {exc}", file=sys.stderr)

    for pdf_path in pdfs:
        try:
            total += ingest_pdf(pdf_path)
        except Exception as exc:
            print(f"Failed PDF {pdf_path}: {exc}", file=sys.stderr)

    for tf in text_files:
        try:
            total += ingest_text_file(tf)
        except Exception as exc:
            print(f"Failed text file {tf}: {exc}", file=sys.stderr)

    print(f"Done. Total new chunks: {total}")


if __name__ == "__main__":
    main()
