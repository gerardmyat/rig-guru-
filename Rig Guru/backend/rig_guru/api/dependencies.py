from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from rig_guru.database import get_db
from rig_guru.models import Users


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> Users:
    """Logged-in user from signed session cookie (set on successful login/register)."""
    raw = request.session.get("user_id")
    if raw is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    try:
        uid = int(raw)
    except (TypeError, ValueError):
        request.session.clear()
        raise HTTPException(status_code=401, detail="Invalid session") from None
    user = db.get(Users, uid)
    if user is None:
        request.session.clear()
        raise HTTPException(status_code=401, detail="User not found")
    return user
