"""Ecobank Notification Service webhook — verify first, then process.

Never trust an incoming payload: the HMAC-SHA512 signature must match before
anything touches the ledger. Event families this build cares about:

- ``collection.confirmed``     → flip the app-initiated collection payment
- ``transfer.completed``       → mark an executed disbursement complete
- ``direct_debit.confirmed``   → settle a pending direct-debit dues pull
- ``account.opened``           → complete an async Account Opening request
- ``mandate.activated``        → complete an async direct-debit mandate
"""

import json
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel import Session, select

from ..audit import audit
from ..db import get_session
from ..ecobank import verify_webhook_signature
from ..live import hub
from ..models import (
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

    if event_type == "collection.confirmed":
        return await _handle_collection_confirmed(session, event, _require_ref(event))
    if event_type == "transfer.completed":
        return await _handle_transfer_completed(session, event, _require_ref(event))
    if event_type == "direct_debit.confirmed":
        return await _handle_direct_debit_confirmed(session, event, _require_ref(event))
    if event_type == "account.opened":
        return await _handle_account_opened(session, event)
    if event_type == "mandate.activated":
        return await _handle_mandate_activated(session, event)

    # Unknown types are acknowledged but ignored — forward compatibility.
    return {"ok": True, "ignored": event_type or "unknown"}


def _require_ref(event: dict) -> str:
    ref = event.get("transactionRef") or event.get("reference")
    if not ref:
        raise HTTPException(status_code=400, detail="Missing transactionRef")
    return str(ref)


async def _handle_direct_debit_confirmed(session: Session, event: dict, ref: str) -> dict:
    """A direct-debit pull settled — flip the pending payment and post to ledger.

    The app already recorded a ``pending`` Payment when it initiated the pull
    (Payment From Ecobank Account); this event confirms settlement. Idempotent:
    a payment already ``success`` is acknowledged without double-posting.
    """
    payment = session.exec(
        select(Payment).where(Payment.ecobank_transaction_ref == ref)
    ).first()
    if payment is None:
        logger.info("webhook for unknown direct-debit ref %s — acknowledging", ref)
        return {"ok": True, "matched": False}

    if payment.status is PaymentStatus.success:
        return {"ok": True, "matched": True, "duplicate": True}

    payment.status = PaymentStatus.success
    payment.timestamp = _event_time(event, payment.timestamp)
    session.add(payment)
    cycle = payment.dues_cycle
    receipts_service.generate_receipt(session, payment)
    entry = ledger_service.append_entry(
        session,
        association_id=cycle.association_id,
        type_=LedgerType.inflow,
        amount=payment.amount,
        reason_or_category=f"Dues (direct debit): {cycle.title}",
        linked_payment_id=payment.id,
    )
    audit(
        session,
        action="webhook_direct_debit_confirmed",
        actor_id=None,
        metadata={
            "payment_id": str(payment.id),
            "ecobank_ref": ref,
            "ledger_entry_id": str(entry.id),
        },
    )
    session.commit()
    await hub.broadcast(
        cycle.association_id,
        {
            "event": "ledger_entry",
            "ledger_entry_id": str(entry.id),
            "payment_id": str(payment.id),
            "type": "inflow",
            "amount": str(payment.amount),
            "cycle": cycle.title,
            "at": utcnow().isoformat(),
        },
    )
    return {"ok": True, "matched": True, "payment_id": str(payment.id)}


async def _handle_account_opened(session: Session, event: dict) -> dict:
    """Complete an asynchronously-provisioned Account Opening request.

    Attribution: the provider echoes our ``customerReference`` (``assoc:record``)
    and/or the new account number. Only a matching member left in
    ``opening_pending`` is completed — a synchronous open is a no-op.
    """
    from ..models import AccountOpeningStatus, MemberRecord

    account_number = event.get("accountNumber") or event.get("accountNo")
    customer_ref = event.get("customerReference") or event.get("reference")
    record: MemberRecord | None = None
    if customer_ref and ":" in str(customer_ref):
        try:
            _, record_id = str(customer_ref).split(":", 1)
            record = session.get(MemberRecord, uuid.UUID(record_id))
        except (ValueError, TypeError):
            record = None
    if record is None and account_number:
        record = session.exec(
            select(MemberRecord).where(
                MemberRecord.linked_account_ref == account_number
            )
        ).first()
    if record is None:
        return {"ok": True, "matched": False}

    if account_number:
        record.linked_account_ref = str(account_number)
    record.account_status = AccountOpeningStatus.opened
    session.add(record)
    audit(
        session,
        action="webhook_account_opened",
        actor_id=None,
        metadata={
            "member_record_id": str(record.id),
            "account_ref": record.linked_account_ref,
        },
    )
    session.commit()
    return {"ok": True, "matched": True, "member_record_id": str(record.id)}


async def _handle_mandate_activated(session: Session, event: dict) -> dict:
    """Flip a pending direct-debit mandate to active after member confirmation."""
    from ..models import DirectDebitMandate, DirectDebitStatus

    mandate_ref = event.get("mandateReference") or event.get("mandateRef") or event.get("reference")
    if not mandate_ref:
        raise HTTPException(status_code=400, detail="Missing mandateReference")
    mandate = session.exec(
        select(DirectDebitMandate).where(DirectDebitMandate.mandate_ref == str(mandate_ref))
    ).first()
    if mandate is None:
        return {"ok": True, "matched": False}
    if mandate.status is DirectDebitStatus.active:
        return {"ok": True, "matched": True, "duplicate": True}
    mandate.status = DirectDebitStatus.active
    mandate.authorized_at = _event_time(event, utcnow())
    session.add(mandate)
    audit(
        session,
        action="webhook_mandate_activated",
        actor_id=None,
        metadata={
            "member_record_id": str(mandate.member_record_id),
            "mandate_ref": mandate.mandate_ref,
        },
    )
    session.commit()
    return {"ok": True, "matched": True, "mandate_ref": mandate.mandate_ref}


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
