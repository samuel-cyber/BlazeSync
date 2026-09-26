"""Disbursement + multi-sig approval service — the core differentiator.

The approval threshold is enforced against the *database*, not the frontend:
every approval insert recomputes the count of distinct approvals inside the
same transaction, and only a transaction that observes >= threshold votes can
transition the request to ``approved`` and release the Ecobank transfer. A
request can never reach ``approved`` without the required number of distinct,
recorded, immutable approval rows — even if the API is hit directly.
"""

import logging
import uuid
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import Session, select

from .. import audit as audit_service
from ..config import settings
from ..ecobank import EcobankError
from ..ecobank import client as ecobank_client
from ..live import hub
from ..models import (
    Association,
    Decision,
    DisbursementApproval,
    DisbursementRequest,
    DisbursementStatus,
    LedgerType,
    Role,
    utcnow,
)
from . import ledger as ledger_service

logger = logging.getLogger(__name__)


def create_request(
    session: Session,
    association: Association,
    requested_by_id: uuid.UUID,
    amount: Decimal,
    reason: str,
    recipient_details: dict,
    idempotency_key: str,
) -> DisbursementRequest:
    existing = session.exec(
        select(DisbursementRequest).where(DisbursementRequest.idempotency_key == idempotency_key)
    ).first()
    if existing:
        return existing  # idempotent replay: return original, don't re-create

    request = DisbursementRequest(
        association_id=association.id,
        requested_by=requested_by_id,
        amount=amount,
        reason=reason,
        recipient_details=recipient_details or {},
        status=DisbursementStatus.pending,
        idempotency_key=idempotency_key,
    )
    session.add(request)
    session.flush()
    audit_service.audit(
        session,
        action="disbursement_requested",
        actor_id=requested_by_id,
        metadata={"disbursement_id": str(request.id), "amount": str(amount), "reason": reason},
    )
    return request


def record_decision(
    session: Session,
    disbursement: DisbursementRequest,
    approver_membership,  # Membership
    decision: Decision,
) -> DisbursementRequest:
    """Record one exco member's approve/reject and evaluate the threshold.

    Runs inside a single transaction guarded by an advisory lock keyed on the
    disbursement id, so two simultaneous approvals can never both drive the
    state machine. The requester cannot approve their own request.
    """
    if disbursement.status not in (DisbursementStatus.pending, DisbursementStatus.approved):
        raise HTTPException(status_code=409, detail=f"Request already {disbursement.status.value}")
    if disbursement.association_id != approver_membership.association_id:
        raise HTTPException(status_code=403, detail="Wrong association for this approval")
    if approver_membership.role not in (Role.treasurer, Role.exco):
        raise HTTPException(status_code=403, detail="Only treasurer or exco can sign off")
    if approver_membership.user_id == disbursement.requested_by:
        raise HTTPException(
            status_code=403, detail="The requester cannot approve their own request"
        )

    # One decision per exco member per request (DB unique constraint backs this).
    existing = session.exec(
        select(DisbursementApproval).where(
            DisbursementApproval.disbursement_id == disbursement.id,
            DisbursementApproval.approved_by == approver_membership.user_id,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="You have already voted on this request")

    approval = DisbursementApproval(
        disbursement_id=disbursement.id,
        approved_by=approver_membership.user_id,
        decision=decision,
        timestamp=utcnow(),
    )
    session.add(approval)
    session.flush()

    # --- Serialize threshold evaluation per disbursement ---
    session.exec(
        text("SELECT pg_advisory_xact_lock(hashtext(:did))").bindparams(did=str(disbursement.id))
    )

    if decision is Decision.rejected:
        disbursement.status = DisbursementStatus.rejected
        session.add(disbursement)
        audit_service.audit(
            session,
            action="disbursement_rejected",
            actor_id=approver_membership.user_id,
            metadata={"disbursement_id": str(disbursement.id)},
        )
        return disbursement

    approvals = session.exec(
        select(DisbursementApproval).where(
            DisbursementApproval.disbursement_id == disbursement.id,
            DisbursementApproval.decision == Decision.approved,
        )
    ).all()
    distinct_approvals = {a.approved_by for a in approvals}
    association = session.get(Association, disbursement.association_id)
    threshold = association.approval_threshold or settings.DEFAULT_APPROVAL_THRESHOLD

    # The gate: transition to approved ONLY if the database holds enough
    # distinct approval rows. This check runs on every approval insert.
    if disbursement.status is DisbursementStatus.pending and len(distinct_approvals) >= threshold:
        disbursement.status = DisbursementStatus.approved
        session.add(disbursement)
        audit_service.audit(
            session,
            action="disbursement_approved",
            actor_id=approver_membership.user_id,
            metadata={
                "disbursement_id": str(disbursement.id),
                "approvals": len(distinct_approvals),
                "threshold": threshold,
            },
        )
    return disbursement


async def maybe_execute(
    session: Session,
    disbursement: DisbursementRequest,
    association: Association,
) -> DisbursementRequest:
    """Execute an approved disbursement via Ecobank Local Bank Payment.

    Called by the router after the decision transaction commits. Idempotent:
    only a request in ``approved`` state transitions to ``completed``, and the
    unique idempotency key scopes the Ecobank call.
    """
    if disbursement.status is not DisbursementStatus.approved:
        return disbursement

    recipient = dict(disbursement.recipient_details or {})
    receiver_account = recipient.get("account_number")
    if not receiver_account:
        raise HTTPException(status_code=400, detail="Recipient account number missing")

    try:
        result = ecobank_client.local_bank_payment(
            source_account_ref=association.treasury_account_ref or "",
            receiver_account_no=receiver_account,
            receiver_bank_code=recipient.get("bank_code", "ECOBANK"),
            amount=Decimal(str(disbursement.amount)),
            description=disbursement.reason[:100],
            idempotency_key=disbursement.idempotency_key,
        )
    except EcobankError as exc:
        logger.error("disbursement transfer failed for %s: %s", disbursement.id, exc)
        raise HTTPException(
            status_code=502, detail="Bank transfer failed — will be retried"
        ) from exc

    if not result.success:
        raise HTTPException(status_code=502, detail=f"Bank rejected transfer: {result.message}")

    disbursement.status = DisbursementStatus.completed
    disbursement.ecobank_transaction_ref = result.transaction_ref
    session.add(disbursement)
    ledger_service.append_entry(
        session,
        association_id=association.id,
        type_=LedgerType.outflow,
        amount=Decimal(str(disbursement.amount)),
        reason_or_category=f"Disbursement: {disbursement.reason}",
        linked_disbursement_id=disbursement.id,
    )
    audit_service.audit(
        session,
        action="disbursement_completed",
        actor_id=None,  # system-triggered after threshold met
        metadata={
            "disbursement_id": str(disbursement.id),
            "ecobank_ref": result.transaction_ref,
        },
    )
    return disbursement


async def broadcast_decision(disbursement: DisbursementRequest) -> None:
    await hub.broadcast(
        disbursement.association_id,
        {
            "event": "disbursement_update",
            "disbursement_id": str(disbursement.id),
            "status": disbursement.status.value,
            "amount": str(disbursement.amount),
            "at": utcnow().isoformat(),
        },
    )
