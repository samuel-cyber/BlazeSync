"""Ecobank Notification Service webhook — verify first, then process.

Never trust an incoming payload: the HMAC-SHA512 signature must match before
anything touches the ledger. Confirmed inflows append ledger entries and push
live updates to connected members.
"""

import json
import logging
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

    # Unknown types are acknowledged but ignored — forward compatibility.
    return {"ok": True, "ignored": event_type or "unknown"}


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
