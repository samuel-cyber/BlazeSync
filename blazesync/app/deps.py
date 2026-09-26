"""Request authentication + association-scoped RBAC dependencies.

Every protected endpoint goes through get_current_user; association-scoped
endpoints additionally go through require_role(...), which checks the caller's
role *in that specific association* — never a global role claim. A member
literally cannot reach disbursement-approval logic, at the dependency layer.
"""

import uuid

import jwt as pyjwt
from fastapi import Depends, Header, HTTPException, status
from sqlmodel import Session, select

from .db import get_session
from .models import Association, Membership, Role, User
from .security import decode_token

_credentials_error = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def _bearer_header(authorization: str | None = Header(default=None)) -> str:
    """Extract the raw Authorization header; the dependency chain validates it."""
    if not authorization:
        raise _credentials_error
    return authorization


def get_current_user(
    authorization: str = Depends(_bearer_header),
    session: Session = Depends(get_session),
) -> User:
    if not authorization.startswith("Bearer "):
        raise _credentials_error
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token, expected_type="access")
    except pyjwt.PyJWTError as exc:
        raise _credentials_error from exc
    user = session.get(User, uuid.UUID(payload["sub"]))
    if user is None:
        raise _credentials_error
    return user


def role_in_association(
    session: Session, user: User, association_id: uuid.UUID
) -> Membership | None:
    return session.exec(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.association_id == association_id,
        )
    ).first()


def require_role(*allowed: Role):
    """Dependency factory: caller must hold one of `allowed` roles in the
    association addressed by the request path parameter `assoc_id`."""

    def dependency(
        assoc_id: uuid.UUID,
        user: User = Depends(get_current_user),
        session: Session = Depends(get_session),
    ) -> Membership:
        membership = role_in_association(session, user, assoc_id)
        if membership is None:
            raise HTTPException(status_code=403, detail="Not a member of this association")
        if allowed and membership.role not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Requires {' or '.join(r.value for r in allowed)} role",
            )
        return membership

    return dependency


def require_association(
    assoc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> tuple[Association, Membership]:
    """Any membership role suffices; returns the association + membership."""
    membership = role_in_association(session, user, assoc_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="Not a member of this association")
    assoc = session.get(Association, assoc_id)
    if assoc is None:
        raise HTTPException(status_code=404, detail="Association not found")
    return assoc, membership


def require_exco_pair(
    assoc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> tuple[Association, Membership]:
    """Treasurer-or-exco gate returning the association, for shared actions."""
    assoc, membership = require_association(assoc_id, user, session)
    if membership.role not in (Role.treasurer, Role.exco):
        raise HTTPException(status_code=403, detail="Requires treasurer or exco role")
    return assoc, membership
