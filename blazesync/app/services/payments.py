"""Payment service — the demo's non-negotiable core.

POST /dues-cycles/{id}/pay → Ecobank Collection Service → receipt → ledger
entry → live broadcast. Idempotent by client-supplied key: a retried request
returns the original result instead of double-charging.
"""

import logging
import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlmodel import Session, select

from ..ecobank import EcobankError
from ..ecobank import client as ecobank_client
from ..live import hub
from ..models import (
    CycleStatus,
    DuesCycle,
    LedgerType,
    MemberRecord,
    Payment,
    PaymentChannel,
    PaymentStatus,
    utcnow,
)
from . import ledger as ledger_service
from . import receipts as receipts_service

logger = logging.getLogger(__name__)


def record_manual_payment(
    session: Session,
    cycle: DuesCycle,
    member_record: MemberRecord,
    amount: Decimal,
    actor_id: uuid.UUID,
) -> Payment:
    """Treasurer marks a roster member paid outside the app (cash/transfer)."""
    existing = session.exec(
        select(Payment).where(
            Payment.member_record_id == member_record.id,
            Payment.dues_cycle_id == cycle.id,
            Payment.status == PaymentStatus.success,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=409, detail="This member already has a successful payment for this cycle"
        )

    payment = Payment(
        dues_cycle_id=cycle.id,
        member_record_id=member_record.id,
        amount=amount,
        paid_via=PaymentChannel.manual,
        status=PaymentStatus.success,
        idempotency_key=f"manual:{cycle.id}:{member_record.id}",
        timestamp=utcnow(),
    )
    session.add(payment)
    session.flush()
    receipts_service.generate_receipt(session, payment)
    ledger_service.append_entry(
        session,
        association_id=cycle.association_id,
        type_=LedgerType.inflow,
        amount=amount,
        reason_or_category=f"Dues (manual): {cycle.title}",
        linked_payment_id=payment.id,
    )
    return payment


def pay_dues(
    session: Session,
    cycle: DuesCycle,
    member_record: MemberRecord,
    amount: Decimal,
    paid_via: PaymentChannel,
    idempotency_key: str,
) -> Payment:
    """Orchestrate a dues payment through the Ecobank Collection Service."""
    # 1. Idempotency: same key → return the original result, never re-process.
    existing = session.exec(
        select(Payment).where(Payment.idempotency_key == idempotency_key)
    ).first()
    if existing:
        if existing.status == PaymentStatus.success:
            return existing
        # a previous attempt failed — allow retry with the same key
        session.delete(existing)
        session.flush()

    if cycle.status != CycleStatus.active:
        raise HTTPException(status_code=409, detail="This dues cycle is closed")
    if member_record.association_id != cycle.association_id:
        raise HTTPException(status_code=400, detail="Member is not on this association's roster")

    # 2. Ecobank Collection Service (mock-mode aware).
    try:
        result = ecobank_client.collect(
            account_ref=_treasury_ref(cycle),
            amount=amount,
            narration=f"{cycle.title} — {member_record.name}",
            idempotency_key=idempotency_key,
            payer_ref=_payer_ref(member_record),
        )
    except EcobankError as exc:
        logger.warning("collection failed for key %s: %s", idempotency_key, exc)
        raise HTTPException(
            status_code=502, detail="Payment provider unavailable, try again"
        ) from exc

    status = PaymentStatus.success if result.success else PaymentStatus.failed
    payment = Payment(
        dues_cycle_id=cycle.id,
        member_record_id=member_record.id,
        amount=amount,
        paid_via=paid_via,
        ecobank_transaction_ref=result.transaction_ref,
        status=status,
        idempotency_key=idempotency_key,
        timestamp=utcnow(),
    )
    session.add(payment)
    session.flush()

    if not result.success:
        raise HTTPException(status_code=402, detail=f"Payment declined: {result.message}")

    # 3. Receipt + 4. Ledger entry — same DB transaction, all-or-nothing.
    receipts_service.generate_receipt(session, payment)
    entry = ledger_service.append_entry(
        session,
        association_id=cycle.association_id,
        type_=LedgerType.inflow,
        amount=amount,
        reason_or_category=f"Dues: {cycle.title}",
        linked_payment_id=payment.id,
    )

    # 5. Live broadcast happens after commit (router calls broadcast_payment).
    payment._ledger_entry_id = entry.id  # type: ignore[attr-defined]
    return payment


def _treasury_ref(cycle: DuesCycle) -> str:
    assoc = cycle.association
    if not assoc.treasury_account_ref:
        raise HTTPException(
            status_code=409, detail="Association has not linked its Ecobank account yet"
        )
    return assoc.treasury_account_ref


def _payer_ref(member_record: MemberRecord) -> str:
    # A claimed member pays from their linked Blaze/Ecobank account; an
    # unclaimed roster member can still pay against their roster identity.
    return (
        member_record.user.linked_account_ref
        if member_record.user and member_record.user.linked_account_ref
        else member_record.email
    )


def build_payment_payload(
    payment: Payment, member_name: str, cycle_title: str
) -> tuple[uuid.UUID, dict]:
    """Build the live-broadcast payload while the session is still open.

    Background tasks run after the request session closes, so every ORM
    attribute must be resolved here — never inside the task itself.
    """
    entry_id = getattr(payment, "_ledger_entry_id", None)
    payload = {
        "event": "ledger_entry",
        "ledger_entry_id": str(entry_id) if entry_id else None,
        "payment_id": str(payment.id),
        "type": "inflow",
        "amount": str(payment.amount),
        "member": member_name,
        "cycle": cycle_title,
    }
    return payment.dues_cycle.association_id, payload


async def broadcast_payload(association_id: uuid.UUID, payload: dict) -> None:
    """Push a prepared payload to the association's live ledger subscribers."""
    payload["at"] = utcnow().isoformat()
    await hub.broadcast(association_id, payload)
    logger.info(
        "broadcast %s to %s clients",
        payload.get("payment_id"),
        hub.connection_count(association_id),
    )
