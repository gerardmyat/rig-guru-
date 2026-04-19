"""Per-user chat threads (sidebar) backed by Postgres."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rig_guru.api.dependencies import get_current_user
from rig_guru.database import get_db
from rig_guru.models import Conversation, Message, Users

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class ConversationOut(BaseModel):
    conversation_id: int
    title: str
    pinned: bool
    title_is_custom: bool
    updated_at: str

    @classmethod
    def from_row(cls, c: Conversation) -> "ConversationOut":
        return cls(
            conversation_id=c.conversationID,
            title=c.title,
            pinned=bool(c.pinned),
            title_is_custom=bool(c.titleIsCustom),
            updated_at=c.updatedAt.isoformat() if c.updatedAt else "",
        )


class ConversationCreate(BaseModel):
    title: Optional[str] = Field(default="New chat", max_length=255)


class ConversationPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    pinned: Optional[bool] = None
    title_is_custom: Optional[bool] = None


class MessageOut(BaseModel):
    id: str
    role: str
    text: str
    timestamp: int


def _get_owned_conversation(db: Session, user_id: int, conv_id: int) -> Conversation:
    c = db.get(Conversation, conv_id)
    if c is None or c.userID != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return c


@router.get("", response_model=List[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db),
    user: Users = Depends(get_current_user),
) -> List[ConversationOut]:
    stmt = (
        select(Conversation)
        .where(Conversation.userID == user.userID)
        .order_by(Conversation.pinned.desc(), Conversation.updatedAt.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return [ConversationOut.from_row(c) for c in rows]


@router.post("", response_model=ConversationOut)
def create_conversation(
    body: ConversationCreate,
    db: Session = Depends(get_db),
    user: Users = Depends(get_current_user),
) -> ConversationOut:
    now = datetime.now(timezone.utc)
    c = Conversation(
        userID=user.userID,
        title=(body.title or "New chat").strip() or "New chat",
        pinned=False,
        titleIsCustom=False,
        createdAt=now,
        updatedAt=now,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return ConversationOut.from_row(c)


@router.patch("/{conversation_id}", response_model=ConversationOut)
def patch_conversation(
    conversation_id: int,
    body: ConversationPatch,
    db: Session = Depends(get_db),
    user: Users = Depends(get_current_user),
) -> ConversationOut:
    c = _get_owned_conversation(db, user.userID, conversation_id)
    if body.title is not None:
        c.title = body.title.strip() or "New chat"
    if body.pinned is not None:
        c.pinned = body.pinned
    if body.title_is_custom is not None:
        c.titleIsCustom = body.title_is_custom
    c.updatedAt = datetime.now(timezone.utc)
    db.commit()
    db.refresh(c)
    return ConversationOut.from_row(c)


@router.delete("/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: Users = Depends(get_current_user),
) -> dict:
    _get_owned_conversation(db, user.userID, conversation_id)
    count_stmt = select(func.count()).select_from(Conversation).where(Conversation.userID == user.userID)
    count = db.execute(count_stmt).scalar_one()
    if count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last conversation")
    c = db.get(Conversation, conversation_id)
    if c:
        db.delete(c)
        db.commit()
    return {"ok": True}


@router.get("/{conversation_id}/messages", response_model=List[MessageOut])
def list_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: Users = Depends(get_current_user),
) -> List[MessageOut]:
    _get_owned_conversation(db, user.userID, conversation_id)
    stmt = (
        select(Message)
        .where(
            Message.conversationID == conversation_id,
            Message.userID == user.userID,
        )
        .order_by(Message.timestamp.asc(), Message.messageID.asc())
    )
    rows = db.execute(stmt).scalars().all()
    out: List[MessageOut] = []
    for m in rows:
        role = "user" if m.senderRole == "user" else "model"
        ts = int(m.timestamp.timestamp() * 1000) if m.timestamp else 0
        out.append(
            MessageOut(
                id=str(m.messageID),
                role=role,
                text=m.content,
                timestamp=ts,
            )
        )
    return out
