"""Password hashing (bcrypt + SHA-256 prehash). Session auth uses cookies, not JWT."""
from __future__ import annotations

import hashlib
import secrets

import bcrypt
from passlib.context import CryptContext

# Legacy DB rows only (e.g. old passlib bcrypt_sha256). New hashes use `bcrypt` on SHA-256 hex.
_legacy_ctx = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")


def _sha256_hex_utf8(plain: str) -> str:
    """64-char ASCII hex; bcrypt input stays under 72 bytes."""
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def _is_modular_bcrypt_hash(password_hash: str) -> bool:
    return password_hash.startswith("$2a$") or password_hash.startswith("$2b$") or password_hash.startswith("$2y$")


def hash_password(plain_password: str) -> str:
    """Store bcrypt(SHA256-hex(password))."""
    secret = _sha256_hex_utf8(plain_password).encode("utf-8")
    return bcrypt.hashpw(secret, bcrypt.gensalt()).decode("ascii")


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Verify new hashes; fall back to legacy bcrypt(plaintext) / passlib schemes."""
    if not _is_modular_bcrypt_hash(password_hash):
        return _legacy_ctx.verify(plain_password, password_hash)

    h = password_hash.encode("utf-8")
    digest = _sha256_hex_utf8(plain_password).encode("utf-8")
    try:
        if bcrypt.checkpw(digest, h):
            return True
    except ValueError:
        pass

    plain_bytes = plain_password.encode("utf-8")
    if len(plain_bytes) > 72:
        plain_bytes = plain_bytes[:72]
    try:
        return bcrypt.checkpw(plain_bytes, h)
    except ValueError:
        return False


def oauth_user_password_hash() -> str:
    """Random bcrypt hash for Google-only accounts (not used for email/password login)."""
    return hash_password(secrets.token_urlsafe(32))
