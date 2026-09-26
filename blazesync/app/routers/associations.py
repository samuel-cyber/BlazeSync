"""Association endpoints: create, Ecobank account linking, exco invites."""

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, func, select

from .. import audit as audit_service
from ..db import get_session
from ..deps import get_current_user, require_association, require_role
from ..ecobank import EcobankError
from ..ecobank import client as ecobank_client
from ..models import (
    Association,
    InviteStatus,
    MemberRecord,
    Membership,
    Role,
    User,
)
from ..security import hash_password

router = APIRouter(prefix="/associations", tags=["associations"])


class CreateAssociationBody(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    institution: str = Field(min_length=2, max_length=200)
    department_or_faculty: str = Field(min_length=2, max_length=200)
    approval_threshold: int = Field(default=2, ge=1, le=10)


@router.post("", status_code=201)
def create_association(
    body: CreateAssociationBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """The creator becomes the association's treasurer."""
    assoc = Association(
        name=body.name.strip(),
        institution=body.institution.strip(),
        department_or_faculty=body.department_or_faculty.strip(),
        created_by=user.id,
        approval_threshold=body.approval_threshold,
    )
    session.add(assoc)
    session.flush()
    session.add(Membership(user_id=user.id, association_id=assoc.id, role=Role.treasurer))
    audit_service.audit(
        session,
        action="association_created",
        actor_id=user.id,
        metadata={"association_id": str(assoc.id), "name": assoc.name},
    )
    session.commit()
    session.refresh(assoc)
    return _association_dict(assoc, Role.treasurer)


def _association_dict(assoc: Association, caller_role: Role) -> dict:
    return {
        "id": str(assoc.id),
        "name": assoc.name,
        "institution": assoc.institution,
        "department_or_faculty": assoc.department_or_faculty,
        "approval_threshold": assoc.approval_threshold,
        "account_linked": bool(assoc.treasury_account_ref),
        "treasury_account_ref": assoc.treasury_account_ref,  # members see the ref, not credentials
        "your_role": caller_role.value,
        "created_at": assoc.created_at.isoformat(),
    }


class JoinBody(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    matric_number: str = Field(min_length=3, max_length=40)
    level: str = Field(default="", max_length=8)


@router.post("/{assoc_id}/join", status_code=201)
def join_by_code(
    assoc_id: uuid.UUID,
    body: JoinBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Self-service join with the association's shared code.

    Creates (or reuses) the caller's roster record so dues tracking covers
    people who never received an individual invite.
    """
    from ..services import roster as roster_service

    assoc = session.get(Association, assoc_id)
    if assoc is None:
        raise HTTPException(status_code=404, detail="Association not found")
    existing = session.exec(
        select(MemberRecord).where(
            MemberRecord.association_id == assoc_id,
            MemberRecord.matric_number == body.matric_number.strip(),
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="That matric number is already on this roster")
    record = MemberRecord(
        association_id=assoc_id,
        name=body.full_name.strip(),
        matric_number=body.matric_number.strip(),
        email=user.email,
        phone=user.phone,
        user_id=user.id,
        invite_code=roster_service.generate_invite_code(),
    )
    record.invite_status = InviteStatus.claimed
    session.add(record)
    if session.exec(
        select(Membership).where(Membership.user_id == user.id, Membership.association_id == assoc_id)
    ).first() is None:
        session.add(Membership(user_id=user.id, association_id=assoc_id, role=Role.member))
    audit_service.audit(
        session,
        action="invite_claimed",
        actor_id=user.id,
        metadata={"association_id": str(assoc_id), "member_record_id": str(record.id), "via": "join_code"},
    )
    session.commit()
    return {"ok": True, "member_record_id": str(record.id)}


@router.get("/by-code/{join_code}")
def association_by_code(join_code: str, session: Session = Depends(get_session)):
    """Public summary behind a shared join code (the /join screen)."""
    code = join_code.strip().upper()
    assoc = session.exec(select(Association).where(func.upper(func.replace(Association.name, " ", "")) == code)).first()
    if assoc is None:
        raise HTTPException(status_code=404, detail="No association uses that code")
    roster_count = session.exec(
        select(func.count()).select_from(MemberRecord).where(MemberRecord.association_id == assoc.id)
    ).one()
    return {
        "id": str(assoc.id),
        "name": assoc.name,
        "institution": assoc.institution,
        "department_or_faculty": assoc.department_or_faculty,
        "approval_threshold": assoc.approval_threshold,
        "account_linked": bool(assoc.treasury_account_ref),
        "treasury_account_ref": assoc.treasury_account_ref,
        "your_role": "member",
        "created_at": assoc.created_at.isoformat(),
        "member_count": roster_count,
    }


class PatchAssociationBody(BaseModel):
    approval_threshold: int = Field(ge=2, le=10)


@router.patch("/{assoc_id}")
def patch_association(
    assoc_id: uuid.UUID,
    body: PatchAssociationBody,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    """Treasurer-only settings update (approval threshold; min 2 by design)."""
    assoc = session.get(Association, assoc_id)
    if assoc is None:
        raise HTTPException(status_code=404, detail="Association not found")
    assoc.approval_threshold = body.approval_threshold
    session.add(assoc)
    audit_service.audit(
        session,
        action="rule_changed",
        actor_id=membership.user_id,
        metadata={"association_id": str(assoc.id), "threshold": body.approval_threshold},
    )
    session.commit()
    session.refresh(assoc)
    return _association_dict(assoc, membership.role)


@router.get("/{assoc_id}")
def get_association(
    assoc_id: uuid.UUID,
    pair=Depends(require_association),
    session: Session = Depends(get_session),
):
    assoc, membership = pair
    return _association_dict(assoc, membership.role)


class LinkAccountBody(BaseModel):
    account_ref: str = Field(min_length=4, max_length=64)


@router.post("/{assoc_id}/link-account")
def link_account(
    assoc_id: uuid.UUID,
    body: LinkAccountBody,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    """Start/complete the Ecobank account-linking consent flow.

    In mock mode (no sandbox credentials) the consent is simulated; with real
    credentials this is where the Ecobank consent handshake completes and the
    scoped account reference is issued. Only a treasurer can link.
    """
    assoc = session.get(Association, assoc_id)
    if assoc is None:
        raise HTTPException(status_code=404, detail="Association not found")
    try:
        live = ecobank_client.account_enquiry(body.account_ref)
    except EcobankError as exc:
        raise HTTPException(status_code=502, detail="Ecobank account enquiry failed") from exc

    assoc.treasury_account_ref = body.account_ref
    session.add(assoc)
    audit_service.audit(
        session,
        action="account_linked",
        actor_id=membership.user_id,
        metadata={
            "association_id": str(assoc.id),
            "account_ref": body.account_ref,
            "currency": live.currency,
        },
    )
    session.commit()
    return {"ok": True, "account_ref": body.account_ref, "verified_balance": str(live.balance)}


class InviteExcoBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr


@router.post("/{assoc_id}/invite-exco", status_code=201)
def invite_exco(
    assoc_id: uuid.UUID,
    body: InviteExcoBody,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    """Provision a co-signatory (exco) account for this association.

    MVP demo flow: if no account exists, one is created with a one-time
    temporary password returned here exactly once — the treasurer hands it to
    the co-signatory over a trusted channel; they rotate it via
    POST /auth/change-password.
    """
    assoc = session.get(Association, assoc_id)
    if assoc is None:
        raise HTTPException(status_code=404, detail="Association not found")
    email = body.email.lower()
    user = session.exec(select(User).where(User.email == email)).first()
    temp_password: str | None = None
    if user is None:
        temp_password = secrets.token_urlsafe(12)
        user = User(name=body.name.strip(), email=email, password_hash=hash_password(temp_password))
        session.add(user)
        session.flush()
    elif session.exec(
        select(Membership).where(
            Membership.user_id == user.id, Membership.association_id == assoc_id
        )
    ).first():
        raise HTTPException(status_code=409, detail="Already a member of this association")

    session.add(Membership(user_id=user.id, association_id=assoc_id, role=Role.exco))
    audit_service.audit(
        session,
        action="exco_invited",
        actor_id=membership.user_id,
        metadata={"association_id": str(assoc_id), "invitee": email},
    )
    session.commit()
    return {
        "ok": True,
        "user_id": str(user.id),
        "temporary_password": temp_password,  # None if the account already existed
        "note": "Share securely; the co-signatory should change it immediately.",
    }
