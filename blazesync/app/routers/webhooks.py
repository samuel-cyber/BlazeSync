"""Ecobank Notification Service webhook — verify first, then process.

Never trust an incoming payload: the HMAC-SHA512 signature must match before
anything touches the ledger. Three event families this build cares about:

- ``collection.confirmed``   → flip the app-initiated collection payment
- ``transfer.completed``     → mark an executed disbursement complete
- ``virtual_account.credit`` → money landed in a member's virtual account —
  attribute it to that member by the account number and reconcile it onto
  the ledger, optionally completing a matching pending dues payment.
"""

import json
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel import Session, select

from ..audit import audit
from ..db import get_session
from ..ecobank import verify_webhook_signature
from ..live import hub
from ..models import (
    LedgerEntry,
    LedgerType,
    Payment,
    PaymentStatus,
    utcnow,
)
from ..services import ledger as ledger_service
from ..services import receipts as receipts_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/ecobank/notification")
async def ecobank_notification(
    request: Request,
    x_ecobank_signature: str | None = Header(default=None),
    session: Session = Depends(get_session),
):
    raw = await request.body()
    if not verify_webhook_signature(raw, x_ecobank_signature):
        # Log the rejection attempt; no processing, no enumeration hints.
        logger.warning(
            "rejected webhook with invalid signature from %s",
            request.client.host if request.client else "unknown",
        )
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        event = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Malformed JSON") from exc

    event_type = event.get("type")
    ref = event.get("transactionRef")
    if not ref:
        raise HTTPException(status_code=400, detail="Missing transactionRef")

    if event_type == "collection.confirmed":
        return await _handle_collection_confirmed(session, event, ref)
    if event_type == "transfer.completed":
        return await _handle_transfer_completed(session, event, ref)
    if event_type == "virtual_account.credit":
        return await _handle_virtual_account_credit(session, event, ref)

    # Unknown types are acknowledged but ignored — forward compatibility.
    return {"ok": True, "ignored": event_type or "unknown"}


async def _handle_virtual_account_credit(session: Session, event: dict, ref: str) -> dict:
    """Money landed in a member's virtual account — attribute and reconcile it.

    The member's VA is the attribution key (spec: "every member gets a unique
    virtual account"), so this handler needs no payment row to exist first.
    Matching that member's pending payment for the association's active cycle
    is best-effort: only an exact-amount, same-member, pending payment flips
    to success; otherwise the credit lands directly on the ledger as an
    attributed inflow that can never be lost.
    """
    from ..models import (
        Association,
        CycleStatus,
        DuesCycle,
        MemberRecord,
        PaymentChannel,
    )

    account_number = (
        event.get("accountNumber")
        or event.get("virtualAccountNo")
        or event.get("creditAccountNumber")
    )
    if not account_number:
        raise HTTPException(status_code=400, detail="Missing virtual account number")
    amount = event.get("amount")
    if amount in (None, ""):
        raise HTTPException(status_code=400, detail="Missing credit amount")
    try:
        credit = Decimal(str(amount))
    except InvalidOperation as exc:
        raise HTTPException(status_code=400, detail="Invalid credit amount") from exc
    if credit <= 0:
        raise HTTPException(status_code=400, detail="Credit amount must be positive")

    record = session.exec(
        select(MemberRecord).where(MemberRecord.virtual_account_ref == account_number)
    ).first()
    if record is None:
        logger.info("VA credit for unknown account %s — acknowledging", account_number)
        return {"ok": True, "matched": False}
    association = session.get(Association, record.association_id)
    if association is None:  # defensive: roster rows always belong to an association
        return {"ok": True, "matched": False}

    # Optional idempotence hook: Ecobank may redeliver the same notification;
    # an identical (ref, account, amount) credit already on the ledger is a no-op.
    existing_note = f"Virtual account credit: {ref}"
    prior = session.exec(
        select(LedgerEntry).where(
            LedgerEntry.association_id == association.id,
            LedgerEntry.reason_or_category == existing_note,
            LedgerEntry.amount == credit,
        )
    ).first()
    if prior is not None:
        return {"ok": True, "matched": True, "duplicate": True}

    matched_payment: Payment | None = None
    cycle = session.exec(
        select(DuesCycle)
        .where(
            DuesCycle.association_id == association.id,
            DuesCycle.status == CycleStatus.active,
        )
        .order_by(DuesCycle.created_at.desc())
    ).first()
    if cycle is not None:
        matched_payment = session.exec(
            select(Payment)
            .where(
                Payment.member_record_id == record.id,
                Payment.dues_cycle_id == cycle.id,
                Payment.status == PaymentStatus.pending,
                Payment.amount == credit,
                Payment.paid_via == PaymentChannel.blaze,
            )
            .order_by(Payment.timestamp.desc())
        ).first()

    if matched_payment is not None:
        matched_payment.status = PaymentStatus.success
        matched_payment.ecobank_transaction_ref = ref
        matched_payment.timestamp = _event_time(event, matched_payment.timestamp)
        session.add(matched_payment)
        receipts_service.generate_receipt(session, matched_payment)
        entry = ledger_service.append_entry(
            session,
            association_id=association.id,
            type_=LedgerType.inflow,
            amount=credit,
            reason_or_category=f"Dues (VA credit): {cycle.title}",
            linked_payment_id=matched_payment.id,
        )
        payment_id = str(matched_payment.id)
        narration = cycle.title
    else:
        entry = ledger_service.append_entry(
            session,
            association_id=association.id,
            type_=LedgerType.inflow,
            amount=credit,
            reason_or_category=existing_note,
        )
        payment_id = None
        narration = "virtual account credit"

    audit(
        session,
        action="virtual_account_credit",
        actor_id=None,
        metadata={
            "association_id": str(association.id),
            "member_record_id": str(record.id),
            "account_number": account_number,
            "amount": str(credit),
            "ecobank_ref": ref,
            "payment_id": payment_id,
            "ledger_entry_id": str(entry.id),
        },
    )
    session.commit()
    await hub.broadcast(
        association.id,
        {
            "event": "ledger_entry",
            "ledger_entry_id": str(entry.id),
            "payment_id": payment_id,
            "type": "inflow",
            "amount": str(credit),
            "member": record.name,
            "cycle": narration,
            "at": utcnow().isoformat(),
        },
    )
    return {"ok": True, "matched": True, "payment_id": payment_id}


async def _handle_collection_confirmed(session: Session, event: dict, ref: str) -> dict:
    payment = session.exec(select(Payment).where(Payment.ecobank_transaction_ref == ref)).first()
    if payment is None:
        logger.info("webhook for unknown collection ref %s — acknowledging", ref)
        return {"ok": True, "matched": False}

    if payment.status is PaymentStatus.success:
        return {"ok": True, "matched": True, "duplicate": True}  # idempotent redelivery

    payment.status = PaymentStatus.success
    payment.timestamp = _event_time(event, payment.timestamp)
    session.add(payment)
    cycle = payment.dues_cycle
    ledger_service.append_entry(
        session,
        association_id=cycle.association_id,
        type_=LedgerType.inflow,
        amount=payment.amount,
        reason_or_category=f"Dues (confirmed): {cycle.title}",
        linked_payment_id=payment.id,
    )
    audit(
        session,
        action="webhook_collection_confirmed",
        actor_id=None,
        metadata={"payment_id": str(payment.id), "ecobank_ref": ref},
    )
    session.commit()
    await hub.broadcast(
        cycle.association_id,
        {
            "event": "ledger_entry",
            "payment_id": str(payment.id),
            "type": "inflow",
            "amount": str(payment.amount),
            "at": utcnow().isoformat(),
        },
    )
    return {"ok": True, "matched": True}


async def _handle_transfer_completed(session: Session, event: dict, ref: str) -> dict:
    from ..models import DisbursementRequest, DisbursementStatus

    request = session.exec(
        select(DisbursementRequest).where(DisbursementRequest.ecobank_transaction_ref == ref)
    ).first()
    if request is None:
        return {"ok": True, "matched": False}
    if request.status is DisbursementStatus.completed:
        return {"ok": True, "matched": True, "duplicate": True}
    request.status = DisbursementStatus.completed
    session.add(request)
    audit(
        session,
        action="webhook_transfer_completed",
        actor_id=None,
        metadata={"disbursement_id": str(request.id), "ecobank_ref": ref},
    )
    session.commit()
    await hub.broadcast(
        request.association_id,
        {"event": "disbursement_update", "disbursement_id": str(request.id), "status": "completed"},
    )
    return {"ok": True, "matched": True}


def _event_time(event: dict, fallback) -> datetime:
    value = event.get("timestamp")
    if not value:
        return fallback
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return fallback
