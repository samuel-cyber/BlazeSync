"""Password hashing + JWT creation/verification.

Explainable auth: bcrypt one-way hashes for passwords; short-lived signed
access tokens carrying the user id; longer-lived refresh tokens that exist as
revocable rows in the database, so a leaked token can be killed server-side.
"""

import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from .config import settings

_ALGORITHM = settings.JWT_ALGORITHM


# --- Passwords -----------------------------------------------------------------


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# --- Tokens --------------------------------------------------------------------


def create_access_token(user_id: uuid.UUID) -> tuple[str, datetime]:
    expires = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
    payload = {
        "sub": str(user_id),
        "type": "access",
        "jti": uuid.uuid4().hex,  # keeps tokens unique even within the same second
        "iat": datetime.now(UTC),
        "exp": expires,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=_ALGORITHM), expires


def create_refresh_token(user_id: uuid.UUID, jti: str) -> tuple[str, datetime]:
    expires = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_DAYS)
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "jti": jti,
        "iat": datetime.now(UTC),
        "exp": expires,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=_ALGORITHM), expires


def decode_token(token: str, expected_type: str) -> dict:
    """Decode and validate a JWT; raises jwt.PyJWTError on any failure."""
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[_ALGORITHM])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"expected {expected_type} token")
    return payload
