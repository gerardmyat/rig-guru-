"""Register, login, Google sign-in — session cookie only (no Bearer tokens)."""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from rig_guru.api.dependencies import get_current_user
from rig_guru.database import get_db
from rig_guru.models import Users
from rig_guru.security import hash_password, oauth_user_password_hash, verify_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

GOOGLE_CLIENT_ID = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
MIN_PASSWORD_LEN = 8


class RegisterBody(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=2, max_length=100)
    password: str = Field(..., min_length=MIN_PASSWORD_LEN)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class GoogleBody(BaseModel):
    id_token: str


class UserSessionOut(BaseModel):
    user_id: int
    email: str
    username: str


class UpdateMeBody(BaseModel):
    username: str = Field(..., min_length=2, max_length=100)


def _validate_username(username: str) -> None:
    if not re.match(r"^[\w\-. ]+$", username):
        raise HTTPException(status_code=400, detail="username has invalid characters")


def _login_session(request: Request, user: Users) -> None:
    request.session.clear()
    request.session["user_id"] = user.userID


@router.post("/register", response_model=UserSessionOut)
def register(request: Request, body: RegisterBody, db: Session = Depends(get_db)) -> UserSessionOut:
    _validate_username(body.username.strip())
    if len(body.password) < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=400, detail=f"password must be at least {MIN_PASSWORD_LEN} characters")

    try:
        pwd_hash = hash_password(body.password)
    except Exception as exc:
        logger.exception("register: password hashing failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Password hashing failed (try: pip install -r requirements.txt): {exc!s}",
        ) from exc

    user = Users(
        username=body.username.strip(),
        email=str(body.email).lower().strip(),
        password=pwd_hash,
        premiumStatus=False,
        googleSub=None,
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="email already registered") from None
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("register DB error: %s", exc)
        err = str(exc).split("\n")[0][:400]
        raise HTTPException(
            status_code=503,
            detail=(
                "Database error while saving the account. "
                "Check: PostgreSQL is running, DATABASE_URL in backend/.env is correct, "
                "database exists, and run backend/scripts/migration_auth.sql if your Users table is old. "
                f"Detail: {err}"
            ),
        ) from exc

    try:
        _login_session(request, user)
    except Exception as exc:
        logger.exception("register: session cookie failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Account was created but login session failed: {exc!s}",
        ) from exc

    return UserSessionOut(user_id=user.userID, email=user.email, username=user.username)


@router.post("/login", response_model=UserSessionOut)
def login(request: Request, body: LoginBody, db: Session = Depends(get_db)) -> UserSessionOut:
    email = str(body.email).lower().strip()
    stmt = select(Users).where(Users.email == email)
    user = db.execute(stmt).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    _login_session(request, user)
    return UserSessionOut(user_id=user.userID, email=user.email, username=user.username)


@router.post("/google", response_model=UserSessionOut)
def google_sign_in(request: Request, body: GoogleBody, db: Session = Depends(get_db)) -> UserSessionOut:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured (set GOOGLE_CLIENT_ID on the server)",
        )
    try:
        info = google_id_token.verify_oauth2_token(
            body.id_token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError as exc:
        logger.warning("Google token verify failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc

    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=401, detail="Wrong token issuer")

    email = (info.get("email") or "").lower().strip()
    sub = info.get("sub")
    if not email or not sub:
        raise HTTPException(status_code=400, detail="Google token missing email")

    user: Optional[Users] = None
    stmt = select(Users).where(Users.googleSub == sub)
    user = db.execute(stmt).scalar_one_or_none()
    if user is None:
        stmt = select(Users).where(Users.email == email)
        user = db.execute(stmt).scalar_one_or_none()
        if user:
            user.googleSub = sub
            if user.password == "changeme" or not user.password.startswith("$2"):
                user.password = oauth_user_password_hash()
            db.commit()
            db.refresh(user)
        else:
            base_username = email.split("@")[0][:80] or "user"
            user = Users(
                username=base_username,
                email=email,
                password=oauth_user_password_hash(),
                premiumStatus=False,
                googleSub=sub,
            )
            db.add(user)
            try:
                db.commit()
                db.refresh(user)
            except IntegrityError:
                db.rollback()
                raise HTTPException(status_code=409, detail="Could not create user") from None

    _login_session(request, user)
    return UserSessionOut(user_id=user.userID, email=user.email, username=user.username)


@router.post("/logout")
def logout(request: Request) -> dict:
    request.session.clear()
    return {"ok": True}


@router.get("/me", response_model=dict)
def me_user(current: Users = Depends(get_current_user)) -> dict:
    return {
        "user_id": current.userID,
        "email": current.email,
        "username": current.username,
    }


@router.patch("/me", response_model=UserSessionOut)
def update_me(
    body: UpdateMeBody,
    db: Session = Depends(get_db),
    current: Users = Depends(get_current_user),
) -> UserSessionOut:
    new_username = body.username.strip()
    _validate_username(new_username)
    if len(new_username) < 2:
        raise HTTPException(status_code=400, detail="username must be at least 2 characters")

    current.username = new_username
    db.add(current)
    try:
        db.commit()
        db.refresh(current)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("update /me failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not update profile right now") from exc

    return UserSessionOut(user_id=current.userID, email=current.email, username=current.username)
