from datetime import datetime, timezone
from contextlib import asynccontextmanager
import logging
import os
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from rig_guru.env import load_backend_dotenv
from rig_guru.database import Base, engine, ensure_default_user_exists, get_db
from rig_guru.models import Conversation, Message, Users
from rig_guru.api.dependencies import get_current_user
from rig_guru.api import auth_routes, conversation_routes
from rig_guru.services.ai_controller import generate_hardware_advice

load_backend_dotenv()

logger = logging.getLogger(__name__)


def _derive_title_from_first_message(text: str) -> str:
    t = text.strip().replace("\n", " ").replace("\r", "")
    if not t:
        return "New chat"
    return (t[:45] + "…") if len(t) > 48 else t


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
        ensure_default_user_exists()
    except SQLAlchemyError as exc:
        logger.warning("Database initialization skipped: %s", exc)
    yield


app = FastAPI(title="Rig Guru API", lifespan=lifespan)

_session_secret = (os.getenv("JWT_SECRET_KEY") or os.getenv("SESSION_SECRET_KEY") or "dev-change-me-use-long-random-string").strip()
# Signed cookie session (no Bearer tokens). Same secret env as before is fine.
app.add_middleware(
    SessionMiddleware,
    secret_key=_session_secret,
    session_cookie="rigguru_session",
    max_age=60 * 60 * 24 * int(os.getenv("SESSION_EXPIRE_DAYS", os.getenv("JWT_EXPIRE_DAYS", "7"))),
    same_site="lax",
    https_only=False,
)

app.include_router(auth_routes.router)
app.include_router(conversation_routes.router)


@app.get("/api/health")
def api_health() -> dict[str, Any]:
    """Quick check: can the API reach PostgreSQL? Open /api/health in the browser."""
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "database": "connected"}
    except Exception as exc:
        logger.warning("health check DB failed: %s", exc)
        return {
            "ok": False,
            "database": "error",
            "detail": str(exc).split("\n")[0][:500],
        }

frontend_port = os.getenv("FRONTEND_PORT", "3000")
allowed_origins = [
    f"http://localhost:{frontend_port}",
    f"http://127.0.0.1:{frontend_port}",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
# /docs in one tab can work while Register fails: the UI runs on another origin (port/host).
# Regex allows any localhost / 127.0.0.1 port so Next on :3001 etc. still gets credentialed CORS.
_local_origin_regex = os.getenv(
    "CORS_LOCAL_ORIGIN_REGEX",
    r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
).strip()
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=_local_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    conversation_id: int


class ChatResponse(BaseModel):
    text: str
    groundingChunks: list[Any]


class GuestChatRequest(BaseModel):
    message: str
    conversation_context: str | None = None


def _recent_conversation_for_model(
    db_session: Session,
    conversation_id: int,
    user_id: int,
    *,
    max_messages: int = 24,
    max_chars: int = 8000,
) -> str:
    """Oldest-first transcript so short follow-ups (e.g. \"its price\") keep prior product context."""
    stmt = (
        select(Message)
        .where(Message.conversationID == conversation_id, Message.userID == user_id)
        .order_by(Message.timestamp.desc(), Message.messageID.desc())
        .limit(max_messages)
    )
    rows = list(reversed(list(db_session.execute(stmt).scalars().all())))
    parts: list[str] = []
    for m in rows:
        role = (m.senderRole or "").lower()
        label = "User" if role == "user" else "Assistant"
        parts.append(f"{label}: {m.content}")
    text = "\n".join(parts)
    if len(text) > max_chars:
        text = text[-max_chars:]
    return text


def _save_message(
    db_session: Session,
    user_id: int,
    conversation_id: int,
    sender_role: str,
    content: str,
) -> None:
    db_session.add(
        Message(
            userID=user_id,
            conversationID=conversation_id,
            timestamp=datetime.now(timezone.utc),
            senderRole=sender_role,
            content=content,
        )
    )
    db_session.commit()


@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db_session: Session = Depends(get_db),
    user: Users = Depends(get_current_user),
) -> ChatResponse:
    try:
        cleaned_message = request.message.strip()
        if not cleaned_message:
            raise HTTPException(status_code=400, detail="message cannot be empty")

        conv = db_session.get(Conversation, request.conversation_id)
        if conv is None or conv.userID != user.userID:
            raise HTTPException(status_code=404, detail="Conversation not found")

        count_stmt = select(func.count()).select_from(Message).where(
            Message.conversationID == request.conversation_id
        )
        prior_count = db_session.execute(count_stmt).scalar_one()

        try:
            _save_message(
                db_session=db_session,
                user_id=user.userID,
                conversation_id=request.conversation_id,
                sender_role="user",
                content=cleaned_message,
            )
        except SQLAlchemyError as exc:
            db_session.rollback()
            logger.warning("Unable to persist user message: %s", exc)

        if prior_count == 0 and not conv.titleIsCustom:
            conv.title = _derive_title_from_first_message(cleaned_message)
        conv.updatedAt = datetime.now(timezone.utc)
        db_session.add(conv)
        db_session.commit()

        conversation_context = _recent_conversation_for_model(
            db_session,
            request.conversation_id,
            user.userID,
        )

        ai_text = await generate_hardware_advice(
            user_id=user.userID,
            prompt=cleaned_message,
            db_session=db_session,
            conversation_context=conversation_context,
        )

        try:
            _save_message(
                db_session=db_session,
                user_id=user.userID,
                conversation_id=request.conversation_id,
                sender_role="model",
                content=ai_text,
            )
        except SQLAlchemyError as exc:
            db_session.rollback()
            logger.warning("Unable to persist model response: %s", exc)

        conv = db_session.get(Conversation, request.conversation_id)
        if conv:
            conv.updatedAt = datetime.now(timezone.utc)
            db_session.add(conv)
            db_session.commit()

        return ChatResponse(
            text=ai_text,
            groundingChunks=[],
        )
    except HTTPException:
        db_session.rollback()
        raise
    except Exception as exc:
        db_session.rollback()
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {exc}") from exc


@app.post("/api/chat/guest", response_model=ChatResponse)
async def chat_guest(
    request: GuestChatRequest,
    db_session: Session = Depends(get_db),
) -> ChatResponse:
    """Guest chat: no login required, no DB persistence."""
    try:
        cleaned_message = request.message.strip()
        if not cleaned_message:
            raise HTTPException(status_code=400, detail="message cannot be empty")

        ai_text = await generate_hardware_advice(
            user_id=0,
            prompt=cleaned_message,
            db_session=db_session,
            conversation_context=(request.conversation_context or "").strip(),
        )
        return ChatResponse(text=ai_text, groundingChunks=[])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Guest chat failed: {exc}") from exc
