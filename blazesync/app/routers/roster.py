"""Roster endpoints: CSV/Excel upload, mass invites, claim flow, manual payments."""

import uuid
from decimal import Decimal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, select

from ..audit import audit
from ..db import get_session
from ..deps import get_current_user, require_role
from ..models import (
    Association,
    CycleStatus,
    DuesCycle,
    MemberRecord,
    Payment,
    PaymentStatus,
    Role,
    User,
)
from ..services import roster as roster_service
from ..services.payments import record_manual_payment

router = APIRouter(tags=["roster"])


class ClaimBody(BaseModel):
    invite_code: str = Field(min_length=8, max_length=64)
    email: EmailStr | None = None
    phone: str | None = None


class MarkPaidBody(BaseModel):
    amount: float | None = None  # defaults to the cycle amount
    note: str | None = None


@router.post("/associations/{assoc_id}/roster/upload")
async def upload_roster(
    assoc_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    """Bulk-import expected members (CSV or XLSX); invite codes are generated per row."""
    if (file.content_type or "") not in {
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=415, detail="Upload a CSV or XLSX file")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Roster file too large (max 5 MB)")
    rows = roster_service.parse_roster(raw, file.filename or "roster.csv")
    if not rows:
        raise HTTPException(
            status_code=400, detail="No usable rows found (need name + email columns)"
        )
    created = roster_service.import_roster(session, assoc_id, rows, actor_id=membership.user_id)
    session.commit()
    return {
        "created": len(created),
        "invites": [
            {"name": r.name, "email": r.email, "invite_code": r.invite_code} for r in created
        ],
        "note": "Invite codes are shown once here for the demo; in production they are emailed.",
    }


@router.post("/associations/{assoc_id}/roster/provision-accounts")
def provision_accounts(
    assoc_id: uuid.UUID,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    """Issue an Ecobank virtual account per roster member (spec: upload → provision).

    Idempotent: already-provisioned members are skipped, so re-running after a
    partial batch finishes the job. In mock mode every member receives a
    deterministic demo account number instantly.
    """
    result = roster_service.provision_accounts(
        session, assoc_id, actor_id=membership.user_id
    )
    session.commit()
    return {"ok": True, **result}


@router.post("/associations/{assoc_id}/roster/send-invites")
def send_invites(
    assoc_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    """Mass-send pending invites (runs as a background task after responding)."""
    count = roster_service.send_invites(session, assoc_id)
    audit(
        session,
        action="invites_sent",
        actor_id=membership.user_id,
        metadata={"association_id": str(assoc_id), "count": count},
    )
    session.commit()
    return {"sent": count}


@router.get("/associations/{assoc_id}/roster")
def roster_status(
    assoc_id: uuid.UUID,
    membership=Depends(require_role(Role.treasurer, Role.exco)),
    session: Session = Depends(get_session),
):
    """Roster with claim status + payment status for the newest active cycle."""
    active_cycle = session.exec(
        select(DuesCycle)
        .where(DuesCycle.association_id == assoc_id, DuesCycle.status == CycleStatus.active)
        .order_by(DuesCycle.created_at.desc())
    ).first()
    items = roster_service.roster_view(session, assoc_id, active_cycle)
    claimed = sum(1 for i in items if i["claimed"])
    return {
        "cycle": {
            "id": str(active_cycle.id),
            "title": active_cycle.title,
            "amount": str(active_cycle.amount),
        }
        if active_cycle
        else None,
        "summary": {"total": len(items), "claimed": claimed, "unclaimed": len(items) - claimed},
        "items": items,
    }


@router.get("/invites/{code}")
def invite_preview(code: str, session: Session = Depends(get_session)):
    """Public invite summary for the claim page.

    Only render-safe fields are exposed — never the contact itself, which is
    the claim page's proof of identity.
    """
    record = session.exec(select(MemberRecord).where(MemberRecord.invite_code == code)).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Invite code not found")
    assoc = session.get(Association, record.association_id)
    if assoc is None:
        raise HTTPException(status_code=404, detail="Association not found")
    # The active cycle and whether this record has already paid it.
    cycle = session.exec(
        select(DuesCycle)
        .where(DuesCycle.association_id == assoc.id, DuesCycle.status == CycleStatus.active)
        .order_by(DuesCycle.created_at.desc())
    ).first()
    paid = None
    if cycle:
        p = session.exec(
            select(Payment).where(
                Payment.dues_cycle_id == cycle.id,
                Payment.member_record_id == record.id,
                Payment.status == PaymentStatus.success,
            )
        ).first()
        paid = str(p.amount) if p else None
    return {
        "name": record.name,
        "matric_number": record.matric_number,
        "invite_status": record.invite_status.value,
        "created_at": record.created_at.isoformat(),
        "association": {
            "id": str(assoc.id),
            "name": assoc.name,
            "institution": assoc.institution,
            "department_or_faculty": assoc.department_or_faculty,
        },
        "cycle": {"id": str(cycle.id), "title": cycle.title, "amount": str(cycle.amount)} if cycle else None,
        "paid_amount": paid,
    }


@router.post("/roster/claim")
def claim(
    body: ClaimBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Link the authenticated user to a roster record via a single-use invite code."""
    record = roster_service.claim_invite(session, user, body.invite_code, body.email, body.phone)
    session.commit()
    return {
        "ok": True,
        "association_id": str(record.association_id),
        "member_record_id": str(record.id),
    }


@router.post("/associations/{assoc_id}/roster/{member_record_id}/mark-paid")
def mark_paid(
    assoc_id: uuid.UUID,
    member_record_id: uuid.UUID,
    body: MarkPaidBody,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    """Manual payment entry — ledger stays authoritative even during rollout."""
    record = session.get(MemberRecord, member_record_id)
    if record is None or record.association_id != assoc_id:
        raise HTTPException(status_code=404, detail="Roster member not found in this association")
    cycle = session.exec(
        select(DuesCycle)
        .where(DuesCycle.association_id == assoc_id, DuesCycle.status == CycleStatus.active)
        .order_by(DuesCycle.created_at.desc())
    ).first()
    if cycle is None:
        raise HTTPException(status_code=409, detail="No active dues cycle for this association")
    amount = body.amount if body.amount is not None else float(cycle.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    payment = record_manual_payment(
        session, cycle, record, Decimal(str(amount)), actor_id=membership.user_id
    )
    audit(
        session,
        action="manual_payment_recorded",
        actor_id=membership.user_id,
        metadata={
            "payment_id": str(payment.id),
            "member_record_id": str(record.id),
            "amount": str(amount),
        },
    )
    session.commit()
    return {"ok": True, "payment_id": str(payment.id), "amount": str(amount)}
