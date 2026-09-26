"""Auth + account endpoints: register, login, refresh (rotated), logout."""

import secrets
import uuid

import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, select

from ..config import settings
from ..db import get_session
from ..deps import get_current_user
from ..models import Association, Membership, RefreshToken, User, utcnow
from ..security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str | None = None
    password: str = Field(min_length=8, max_length=128)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class RefreshBody(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


def _issue_tokens(session: Session, user: User) -> TokenPair:
    access, _ = create_access_token(user.id)
    jti = secrets.token_urlsafe(24)
    refresh, refresh_expires = create_refresh_token(user.id, jti)
    session.add(RefreshToken(user_id=user.id, jti=jti, revoked=False, expires_at=refresh_expires))
    session.commit()
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
    )


@router.post("/register", response_model=TokenPair, status_code=201)
def register(body: RegisterBody, session: Session = Depends(get_session)):
    if session.exec(select(User).where(User.email == body.email.lower())).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    if body.phone and session.exec(select(User).where(User.phone == body.phone)).first():
        raise HTTPException(status_code=409, detail="An account with this phone already exists")
    user = User(
        name=body.name.strip(),
        email=body.email.lower(),
        phone=body.phone,
        password_hash=hash_password(body.password),
    )
    session.add(user)
    session.flush()
    tokens = _issue_tokens(session, user)
    return tokens


@router.post("/login", response_model=TokenPair)
def login(body: LoginBody, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == body.email.lower())).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _issue_tokens(session, user)


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshBody, session: Session = Depends(get_session)):
    """Rotate the refresh token: the presented one is revoked immediately."""
    try:
        payload = decode_token(body.refresh_token, expected_type="refresh")
    except pyjwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid refresh token") from exc

    row = session.exec(select(RefreshToken).where(RefreshToken.jti == payload["jti"])).first()
    if row is None or row.revoked or row.expires_at < utcnow():
        raise HTTPException(status_code=401, detail="Refresh token revoked or expired")

    user = session.get(User, uuid.UUID(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="Account no longer exists")

    row.revoked = True
    session.add(row)
    return _issue_tokens(session, user)


@router.get("/me/memberships")
def my_memberships(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Every association the caller belongs to, with their role in each.

    The frontend uses this after login to auto-detect the right portal
    (treasurer / exco / member) and to power the association switcher.
    """
    rows = session.exec(
        select(Membership, Association)
        .join(Association, Association.id == Membership.association_id)
        .where(Membership.user_id == user.id)
        .order_by(Association.created_at)
    ).all()
    return {
        "user": {"id": str(user.id), "name": user.name, "email": user.email, "phone": user.phone},
        "items": [
            {
                "association_id": str(m.association_id),
                "role": m.role.value,
                "name": a.name,
                "institution": a.institution,
                "department_or_faculty": a.department_or_faculty,
                "approval_threshold": a.approval_threshold,
                "account_linked": bool(a.treasury_account_ref),
                "created_at": a.created_at.isoformat(),
            }
            for m, a in rows
        ],
    }


@router.post("/logout")
def logout(body: RefreshBody, session: Session = Depends(get_session)):
    """Revoke the presented refresh token (access token simply expires)."""
    try:
        payload = decode_token(body.refresh_token, expected_type="refresh")
    except pyjwt.PyJWTError:
        return {"ok": True}  # logout is idempotent
    row = session.exec(select(RefreshToken).where(RefreshToken.jti == payload["jti"])).first()
    if row and not row.revoked:
        row.revoked = True
        session.add(row)
        session.commit()
    return {"ok": True}
