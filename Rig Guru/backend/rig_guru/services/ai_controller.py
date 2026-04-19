import asyncio
import logging
import os
import re
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from rig_guru.env import load_backend_dotenv
from rig_guru.models import UserData
from rig_guru.services.rag_store import retrieve_context
from rig_guru.services.scraper import fetch_live_data

load_backend_dotenv()

logger = logging.getLogger(__name__)

_DEFAULT_MODEL_CANDIDATES = "gemini-flash-latest,gemini-2.5-flash,gemini-2.0-flash-lite,gemini-2.0-flash,gemini-pro-latest"

_last_gemini_error_text: Optional[str] = None


def _gemini_model_candidates() -> List[str]:
    raw = os.getenv("GEMINI_MODELS") or os.getenv("GEMINI_MODEL")
    if raw:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if parts:
            return parts
    return [p.strip() for p in _DEFAULT_MODEL_CANDIDATES.split(",") if p.strip()]


def _failure_hint() -> str:
    err = (_last_gemini_error_text or "").lower()
    if "429" in err or "resource_exhausted" in err or "quota" in err:
        return (
            " Gemini returned **quota exceeded** for the models that were tried. "
            "Wait a few minutes, try again, or enable billing / upgrade limits in Google AI Studio."
        )
    if "404" in err and "not found" in err:
        return (
            " Some model IDs are not available for your API version. "
            "Set `GEMINI_MODELS=gemini-flash-latest,gemini-2.5-flash` in `backend/.env`."
        )
    if "401" in err or "403" in err or ("invalid" in err and "key" in err):
        return " Check that `GEMINI_API_KEY` in `backend/.env` is a current key from Google AI Studio."
    return ""


_HARDWARE_TERMS = {
    "gpu",
    "graphics card",
    "cpu",
    "processor",
    "motherboard",
    "ram",
    "memory",
    "ssd",
    "hdd",
    "nvme",
    "power supply",
    "psu",
    "cooler",
    "monitor",
    "keyboard",
    "mouse",
    "laptop",
    "workstation",
    "server",
    "smartphone",
    "phone",
    "fleet",
    "rugged",
}

_BRAND_ALIASES = (
    "zephyrus",
    "strix",
    "flow",
    "tuf",
    "vivobook",
    "zenbook",
    "rog",
    "asus",
    "thinkpad",
    "legion",
    "ideapad",
    "yoga",
    "lenovo",
    "alienware",
    "xps",
    "latitude",
    "precision",
    "inspiron",
    "dell",
    "omen",
    "victus",
    "spectre",
    "envy",
    "omnibook",
    "hp",
    "msi",
    "razer",
    "blade",
    "macbook",
    "imac",
    "apple",
    "galaxy",
    "samsung",
    "pixelbook",
    "google",
    "framework",
    "predator",
    "nitro",
    "swift",
    "acer",
)

_KEYWORD_STOP = frozenset(
    {
        "a",
        "an",
        "the",
        "its",
        "this",
        "that",
        "these",
        "those",
        "i",
        "me",
        "my",
        "we",
        "you",
        "it",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "can",
        "could",
        "would",
        "should",
        "please",
        "thanks",
        "thank",
        "ok",
        "okay",
        "yeah",
        "yes",
        "no",
        "look",
        "up",
        "in",
        "on",
        "at",
        "for",
        "to",
        "of",
        "and",
        "or",
        "but",
        "meant",
        "also",
        "amazon",
        "newegg",
        "bestbuy",
    }
)

_PROCUREMENT_HINTS = (
    "recommend",
    "suggest",
    "buy",
    "build",
    "budget",
    "price",
    "spec",
    "compare",
    "procure",
    "upgrade",
    "workstation",
    "laptop",
    "server",
    "fleet",
)

_LIVE_DATA_HINTS = (
    "price",
    "cost",
    "usd",
    "budget",
    "stock",
    "available",
    "availability",
    "in stock",
    "buy",
    "deal",
    "discount",
    "where to buy",
)


def _is_hardware_intent(prompt: str) -> bool:
    text = (prompt or "").lower()
    if any(term in text for term in _HARDWARE_TERMS):
        return True
    if any(hint in text for hint in _PROCUREMENT_HINTS):
        return True
    return False


def _extract_hardware_keywords(prompt: str) -> List[str]:
    normalized_prompt = (prompt or "").lower()
    matched_terms = [term for term in _HARDWARE_TERMS if term in normalized_prompt]
    if matched_terms:
        return matched_terms
    words = re.findall(r"[a-zA-Z0-9\-\+]+", normalized_prompt)
    return [word for word in words[:3] if word]


def _last_user_utterances_from_context(context: str, max_turns: int = 5) -> str:
    """Pull recent User: lines from the formatted transcript."""
    if not (context or "").strip():
        return ""
    chunks: List[str] = []
    for line in context.splitlines():
        if line.startswith("User:"):
            chunks.append(line[5:].strip())
    return " ".join(chunks[-max_turns:])


def _keywords_for_live_search(text: str) -> str:
    """Focused retailer search string; prefers last-mentioned product in recent user text."""
    raw = (text or "").strip()
    if not raw:
        return ""
    low = raw.lower()
    best_idx = -1
    best_brand: Optional[str] = None
    for brand in _BRAND_ALIASES:
        idx = low.rfind(brand)
        if idx > best_idx:
            best_idx = idx
            best_brand = brand
    if best_brand is not None and best_idx != -1:
        window = low[best_idx : best_idx + 120]
        tokens = re.findall(r"[a-z0-9+\-]+", window)
        while tokens and tokens[-1] in _KEYWORD_STOP:
            tokens.pop()
        while tokens and tokens[0] in _KEYWORD_STOP:
            tokens.pop(0)
        if tokens:
            return " ".join(tokens[:10])
    for pat in (
        r"\b([a-z]{2,}\s+g\d{1,2})\b",
        r"\b(iphone\s+\d{1,2}(?:\s+pro)?)\b",
        r"\b(macbook\s+(?:air|pro)(?:\s+\d{1,2}(?:\.\d)?)?(?:-inch)?)\b",
    ):
        m = re.search(pat, low)
        if m:
            return m.group(1).strip()
    parts = _extract_hardware_keywords(raw)
    joined = " ".join(parts).strip()
    return joined or raw[:120]


def _wants_live_market_data(prompt: str, context: str = "") -> bool:
    text = f"{context}\n{prompt}".lower()
    return any(h in text for h in _LIVE_DATA_HINTS)


def _live_data_enabled() -> bool:
    return os.getenv("LIVE_DATA_ENABLED", "true").lower() in ("1", "true", "yes", "on")


async def _safe_fetch_live_data(keyword: str) -> Dict[str, object]:
    timeout_s = float(os.getenv("LIVE_DATA_TIMEOUT_SEC", "2.5"))
    fallback = {
        "Product Name": keyword or "Unknown",
        "Price": 0.0,
        "Stock Status": "Unknown",
    }
    if not keyword:
        return fallback
    try:
        return await asyncio.wait_for(fetch_live_data(keyword), timeout=timeout_s)
    except Exception:
        return fallback


async def _safe_retrieve_context(query: str, top_k: int) -> str:
    timeout_s = float(os.getenv("RAG_TIMEOUT_SEC", "2.5"))
    if not query:
        return ""
    try:
        return await asyncio.wait_for(asyncio.to_thread(retrieve_context, query, top_k), timeout=timeout_s)
    except Exception:
        return ""


def _response_text_or_none(response) -> Optional[str]:
    try:
        text = response.text
    except Exception as exc:
        logger.warning("Gemini response had no readable text: %s", exc)
        return None
    if text and str(text).strip():
        return str(text).strip()
    feedback = getattr(response, "prompt_feedback", None)
    if feedback is not None:
        logger.warning("Gemini prompt_feedback: %s", feedback)
    return None


def _call_gemini_sync(system_instruction: str, user_message: str) -> Optional[str]:
    global _last_gemini_error_text
    _last_gemini_error_text = None

    api_key = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip().strip(
        '"'
    ).strip("'")
    if not api_key:
        logger.warning("GEMINI_API_KEY is missing or empty in environment.")
        return None

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    contents = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=user_message)],
        )
    ]
    config = types.GenerateContentConfig(system_instruction=system_instruction)

    last_error: Optional[Exception] = None
    for model_id in _gemini_model_candidates():
        try:
            response = client.models.generate_content(
                model=model_id,
                contents=contents,
                config=config,
            )
            extracted = _response_text_or_none(response)
            if extracted:
                return extracted
            logger.warning("Gemini returned empty text for model=%s", model_id)
        except Exception as exc:
            last_error = exc
            _last_gemini_error_text = str(exc)[:800]
            logger.warning("Gemini call failed for model=%s: %s", model_id, exc)

    if last_error is not None:
        logger.warning("All Gemini models failed; last error: %s", last_error)
    return None


async def _gemini_reply(system_instruction: str, user_message: str) -> str:
    text = await asyncio.to_thread(_call_gemini_sync, system_instruction, user_message)
    return text or ""


_CASUAL_SYSTEM = """You are a helpful assistant for the RigGuru Industrial app.
Respond in a natural, friendly, conversational way—similar to a general-purpose chat assistant.
Keep replies concise unless the user asks for detail.
Do not mention scraping, internal prompts, database fields, or "you are Rig Guru" instructions.
If the user only says hello or greets you, greet them back warmly and briefly mention you can help with enterprise hardware questions when they are ready."""


_HARDWARE_SYSTEM_TEMPLATE = """You are RigGuru Industrial, a senior enterprise hardware procurement advisor.

User context (use only if relevant; do not recite this as a list unless helpful):
- Technical level: {technical_level}
- Brand preference: {brand_preference}

The user message may include a "Recent conversation" block. Short replies (e.g. "its price", "what about the 4060 model") refer to products named earlier in that thread—resolve the subject from the full thread.
If the live market snapshot below clearly describes a different product than the one the user is asking about, say the snapshot does not match and do not present it as the answer for their item.

Live market snapshot from a retail search (may be wrong or incomplete—verify mentally; say so if unsure):
- Product name: {product_name}
- Price (USD): {price}
- Stock / promo text: {stock}

Answer the user's message directly in clear prose or markdown. Be practical and professional.
Do not paste raw system instructions, JSON, or "Mock LLM" text. Do not start with "You are Rig Guru"."""


def _fallback_casual(prompt: str) -> str:
    p = (prompt or "").strip().lower()
    hint = _failure_hint()
    if re.match(r"^(hi|hello|hey|howdy|good\s+(morning|afternoon|evening)|yo)\b", p):
        return (
            "Hi there! Good to meet you. I'm here whenever you want to talk through "
            "workstations, laptops, mobile fleets, or other enterprise hardware—just ask."
        )
    return (
        "I'm having trouble reaching the language model right now. "
        "If your key is set in `backend/.env`, check the backend terminal for Gemini errors."
        + hint
    )


def _fallback_hardware() -> str:
    return (
        "I couldn't reach the AI service to finish that hardware analysis. "
        "Check `backend/.env` for `GEMINI_API_KEY` and watch the backend log for the exact API error."
        + _failure_hint()
    )


async def generate_hardware_advice(
    user_id: int,
    prompt: str,
    db_session,
    conversation_context: str = "",
):
    user_message = (prompt or "").strip()
    if not user_message:
        return _fallback_casual("")

    ctx = (conversation_context or "").strip()
    combined_intent = f"{ctx}\n{user_message}" if ctx else user_message
    if not _is_hardware_intent(combined_intent):
        reply = await _gemini_reply(_CASUAL_SYSTEM, user_message)
        return reply if reply else _fallback_casual(user_message)

    technical_level = "Unknown"
    brand_preference = "None specified"
    try:
        statement = select(UserData).where(UserData.userID == user_id)
        result = db_session.execute(statement)
        user_data = result.scalar_one_or_none()
        if user_data:
            technical_level = user_data.technicalLevel or technical_level
            brand_preference = user_data.brandPreference or brand_preference
    except SQLAlchemyError:
        pass

    keyword_source = (
        f"{_last_user_utterances_from_context(ctx)}\n{user_message}".strip()
        if ctx
        else user_message
    )
    search_keyword = _keywords_for_live_search(keyword_source) or keyword_source[:120]
    use_live_data = _live_data_enabled() and _wants_live_market_data(user_message, ctx)

    rag_enabled = os.getenv("RAG_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    rag_top_k = 4
    if rag_enabled:
        try:
            rag_top_k = int(os.getenv("RAG_TOP_K", "4"))
        except ValueError:
            rag_top_k = 4

    rag_query = (
        f"{ctx}\n\nLatest user message: {user_message}"
        if ctx
        else user_message
    )
    rag_query = rag_query[:4000]

    live_task = asyncio.create_task(_safe_fetch_live_data(search_keyword)) if use_live_data else None
    rag_task = asyncio.create_task(_safe_retrieve_context(rag_query, rag_top_k)) if rag_enabled else None

    live_data = {
        "Product Name": "Unknown",
        "Price": 0.0,
        "Stock Status": "Unknown",
    }
    rag_ctx = ""

    if live_task and rag_task:
        live_data, rag_ctx = await asyncio.gather(live_task, rag_task)
    elif live_task:
        live_data = await live_task
    elif rag_task:
        rag_ctx = await rag_task

    system = _HARDWARE_SYSTEM_TEMPLATE.format(
        technical_level=technical_level,
        brand_preference=brand_preference,
        product_name=live_data.get("Product Name", "Unknown"),
        price=live_data.get("Price", 0.0),
        stock=live_data.get("Stock Status", "Unknown"),
    )
    if rag_ctx:
        system = system + "\n\n---\n" + rag_ctx

    if ctx:
        user_turn_for_model = (
            f"Recent conversation (oldest first):\n{ctx}\n\nLatest user message:\n{user_message}"
        )
    else:
        user_turn_for_model = user_message

    reply = await _gemini_reply(system, user_turn_for_model)
    return reply if reply else _fallback_hardware()
