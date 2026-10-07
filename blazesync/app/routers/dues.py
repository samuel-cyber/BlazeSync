"""Dues cycles + payment endpoints (the demo's non-negotiable core)."""

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..audit import audit
from ..db import get_session
from ..deps import get_current_user, require_role, role_in_association
from ..models import (
    CycleStatus,
    DuesCycle,
    MemberRecord,
    Membership,
    Payment,
    PaymentChannel,
    Receipt,
    Role,
    User,
)
from ..services import payments as payments_service
from ..services import receipts as receipts_service

router = APIRouter(tags=["dues", "payments"])


class CreateCycleBody(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    amount: float = Field(gt=0)
    deadline: datetime
    # What the money funds — shown on every receipt for the cycle.
    expectation_statement: str | None = Field(default=None, max_length=2000)
    # Optional per-level overrides in naira: {"100L": 2000, "300L": 5000}.
    per_level: dict[str, float] | None = None


@router.post("/associations/{assoc_id}/dues-cycles", status_code=201)
def create_cycle(
    assoc_id: uuid.UUID,
    body: CreateCycleBody,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    cycle = DuesCycle(
        association_id=assoc_id,
        title=body.title.strip(),
        amount=Decimal(str(body.amount)),
        expectation_statement=(body.expectation_statement.strip() if body.expectation_statement else None),
        per_level={k: float(v) for k, v in body.per_level.items()} if body.per_level else None,
        deadline=body.deadline,
        created_by=membership.user_id,
    )
    session.add(cycle)
    audit(
        session,
        action="dues_cycle_created",
        actor_id=membership.user_id,
        metadata={
            "association_id": str(assoc_id),
            "cycle_id": str(cycle.id),
            "title": cycle.title,
            "amount": str(body.amount),
        },
    )
    session.commit()
    session.refresh(cycle)
    return _cycle_dict(cycle)


@router.get("/associations/{assoc_id}/dues-cycles")
def list_cycles(
    assoc_id: uuid.UUID,
    membership=Depends(require_role()),
    session: Session = Depends(get_session),
):
    cycles = session.exec(
        select(DuesCycle)
        .where(DuesCycle.association_id == assoc_id)
        .order_by(DuesCycle.created_at.desc())
    ).all()
    return {"items": [_cycle_dict(c) for c in cycles]}


class PatchCycleBody(BaseModel):
    title: str | None = None
    deadline: datetime | None = None
    status: CycleStatus | None = None
    expectation_statement: str | None = Field(default=None, max_length=2000)


@router.patch("/dues-cycles/{cycle_id}")
def patch_cycle(
    cycle_id: uuid.UUID,
    body: PatchCycleBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Edit or close a dues cycle (treasurer of the owning association only)."""
    cycle = session.get(DuesCycle, cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Dues cycle not found")
    membership = role_in_association(session, user, cycle.association_id)
    if membership is None or membership.role is not Role.treasurer:
        raise HTTPException(status_code=403, detail="Requires treasurer role in this association")
    if cycle.status is CycleStatus.closed and body.status is CycleStatus.active:
        raise HTTPException(status_code=409, detail="A closed cycle cannot be reopened")
    if body.title is not None:
        cycle.title = body.title.strip()
    if body.deadline is not None:
        cycle.deadline = body.deadline
    if body.status is not None:
        cycle.status = body.status
    if body.expectation_statement is not None:
        cycle.expectation_statement = body.expectation_statement.strip() or None
    session.add(cycle)
    audit(
        session,
        action="dues_cycle_updated",
        actor_id=membership.user_id,
        metadata={
            "cycle_id": str(cycle.id),
            **{k: str(v) for k, v in body.model_dump(exclude_none=True).items()},
        },
    )
    session.commit()
    session.refresh(cycle)
    return _cycle_dict(cycle)


class PayBody(BaseModel):
    paid_via: PaymentChannel
    idempotency_key: str = Field(min_length=8, max_length=120)


@router.post("/dues-cycles/{cycle_id}/pay")
def pay(
    cycle_id: uuid.UUID,
    body: PayBody,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Pay dues via the Ecobank Collection Service (mock-mode aware).

    The caller must be a claimed roster member. On success the receipt is
    generated and the ledger entry appended in the same transaction; the new
    entry is then broadcast live.
    """
    cycle = session.get(DuesCycle, cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Dues cycle not found")
    record = session.exec(
        select(MemberRecord).where(
            MemberRecord.association_id == cycle.association_id,
            MemberRecord.user_id == user.id,
        )
    ).first()
    if record is None:
        raise HTTPException(
            status_code=403,
            detail="Your account is not linked to this association's roster — "
            "claim your invite first",
        )

    # Per-level pricing overrides the flat amount when the cycle defines it
    # for the payer's level (spec 4.2).
    per_level = cycle.per_level or {}
    level_amount = per_level.get(record.level)
    amount = Decimal(str(level_amount)) if level_amount is not None else Decimal(str(cycle.amount))

    payment = payments_service.pay_dues(
        session,
        cycle=cycle,
        member_record=record,
        amount=amount,
        paid_via=body.paid_via,
        idempotency_key=body.idempotency_key.strip(),
    )
    audit(
        session,
        action="dues_paid",
        actor_id=user.id,
        metadata={
            "payment_id": str(payment.id),
            "cycle_id": str(cycle.id),
            "status": payment.status.value,
        },
    )
    session.commit()
    session.refresh(payment)
    # Build the broadcast payload while the session is open; the background
    # task runs after it closes, so it must not touch ORM lazy loads.
    association_id, payload = payments_service.build_payment_payload(
        payment, member_name=record.name, cycle_title=cycle.title
    )
    background_tasks.add_task(payments_service.broadcast_payload, association_id, payload)
    return _payment_dict(session, payment)


@router.get("/payments/{payment_id}/receipt")
def payment_receipt(
    payment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Receipt + live hash re-verification — the tamper-evidence demo moment."""
    payment = session.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    cycle = payment.dues_cycle
    # The payer, or any member of the association (shared ledger transparency),
    # may view a receipt; outsiders cannot.
    is_payer = payment.member_record.user_id == user.id
    is_member = (
        session.exec(
            select(Membership).where(
                Membership.association_id == cycle.association_id,
                Membership.user_id == user.id,
            )
        ).first()
        is not None
    )
    if not (is_payer or is_member):
        raise HTTPException(status_code=403, detail="Not authorized to view this receipt")

    verification = receipts_service.verify_receipt(session, payment)
    receipt = session.exec(
        select(Receipt)
        .where(Receipt.payment_id == payment.id)
        .order_by(Receipt.generated_at.desc())
    ).first()
    return {
        "payment_id": str(payment.id),
        "amount": str(payment.amount),
        "paid_via": payment.paid_via.value,
        "status": payment.status.value,
        "ecobank_transaction_ref": payment.ecobank_transaction_ref,
        "timestamp": payment.timestamp.isoformat(),
        "receipt_hash": receipt.hash if receipt else None,
        "recomputed_hash": verification.get("recomputed_hash"),
        "verified": verification.get("verified", False),
        # What the money funds — frozen at payment time on the receipt.
        "expectation_statement": (
            receipt.expectation_statement_snapshot
            if receipt and receipt.expectation_statement_snapshot
            else cycle.expectation_statement
        ),
    }


@router.get("/users/me/payments")
def my_payments(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Personal payment history across all associations and semesters."""
    records = session.exec(select(MemberRecord).where(MemberRecord.user_id == user.id)).all()
    record_ids = [r.id for r in records]
    if not record_ids:
        return {"items": []}
    payments = session.exec(
        select(Payment)
        .where(Payment.member_record_id.in_(record_ids))
        .order_by(Payment.timestamp.desc())
    ).all()
    return {"items": [_payment_dict(session, p) for p in payments]}


def _cycle_dict(cycle: DuesCycle) -> dict:
    return {
        "id": str(cycle.id),
        "association_id": str(cycle.association_id),
        "title": cycle.title,
        "amount": str(cycle.amount),
        "expectation_statement": cycle.expectation_statement,
        "per_level": {k: str(v) for k, v in cycle.per_level.items()} if cycle.per_level else None,
        "deadline": cycle.deadline.isoformat(),
        "status": cycle.status.value,
        "created_at": cycle.created_at.isoformat(),
    }


def _payment_dict(session: Session, payment: Payment) -> dict:
    receipt = session.exec(
        select(Receipt)
        .where(Receipt.payment_id == payment.id)
        .order_by(Receipt.generated_at.desc())
    ).first()
    return {
        "id": str(payment.id),
        "dues_cycle_id": str(payment.dues_cycle_id),
        "member_record_id": str(payment.member_record_id),
        "amount": str(payment.amount),
        "paid_via": payment.paid_via.value,
        "status": payment.status.value,
        "ecobank_transaction_ref": payment.ecobank_transaction_ref,
        "timestamp": payment.timestamp.isoformat(),
        "receipt_hash": receipt.hash if receipt else None,
        "expectation_statement": (
            receipt.expectation_statement_snapshot
            if receipt and receipt.expectation_statement_snapshot
            else payment.dues_cycle.expectation_statement
        ),
    }
