"""Disbursement endpoints — request, list, approve/reject with multi-sig enforcement.

After each recorded decision the router checks whether the threshold has been
met (server-side state transition, not UI) and executes the Ecobank Local
Bank Payment, then writes the outflow ledger entry and broadcasts live.
"""

import uuid
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..db import get_session
from ..deps import get_current_user, require_role, role_in_association
from ..models import (
    Association,
    Decision,
    DisbursementApproval,
    DisbursementRequest,
    DisbursementStatus,
    Role,
    User,
)
from ..security import verify_password
from ..services import disbursements as disbursements_service

router = APIRouter(tags=["disbursements"])


class CreateDisbursementBody(BaseModel):
    amount: float = Field(gt=0)
    reason: str = Field(min_length=3, max_length=300)
    recipient_name: str = Field(min_length=2, max_length=160)
    recipient_account_number: str = Field(min_length=6, max_length=20)
    recipient_bank_code: str = Field(default="ECOBANK", max_length=20)
    idempotency_key: str = Field(min_length=8, max_length=120)


@router.post("/associations/{assoc_id}/disbursements", status_code=201)
def create_disbursement(
    assoc_id: uuid.UUID,
    body: CreateDisbursementBody,
    membership=Depends(require_role(Role.treasurer)),
    session: Session = Depends(get_session),
):
    request = disbursements_service.create_request(
        session,
        association=session.get(Association, assoc_id),
        requested_by_id=membership.user_id,
        amount=Decimal(str(body.amount)),
        reason=body.reason.strip(),
        recipient_details={
            "name": body.recipient_name,
            "account_number": body.recipient_account_number,
            "bank_code": body.recipient_bank_code,
        },
        idempotency_key=body.idempotency_key.strip(),
    )
    session.commit()
    session.refresh(request)
    return _disbursement_dict(session, request)


@router.get("/associations/{assoc_id}/disbursements")
def list_disbursements(
    assoc_id: uuid.UUID,
    status: DisbursementStatus | None = Query(default=None),
    membership=Depends(require_role(Role.treasurer, Role.exco)),
    session: Session = Depends(get_session),
):
    stmt = (
        select(DisbursementRequest)
        .where(DisbursementRequest.association_id == assoc_id)
        .order_by(DisbursementRequest.created_at.desc())
    )
    if status is not None:
        stmt = stmt.where(DisbursementRequest.status == status)
    requests = session.exec(stmt).all()
    return {"items": [_disbursement_dict(session, r) for r in requests]}


class DecisionBody(BaseModel):
    # Rejection requires password re-entry — a small but real friction point
    # against spuriously rejecting a pending payout.
    password: str | None = Field(default=None, description="Required to reject")


def _disbursement_or_404(session: Session, disbursement_id: uuid.UUID) -> DisbursementRequest:
    request = session.get(DisbursementRequest, disbursement_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Disbursement request not found")
    return request


@router.post("/disbursements/{disbursement_id}/approve")
def approve(
    disbursement_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Exco/treasurer signs off. Threshold transitions are enforced server-side."""
    request = _disbursement_or_404(session, disbursement_id)
    membership = role_in_association(session, user, request.association_id)
    if membership is None or membership.role not in (Role.treasurer, Role.exco):
        raise HTTPException(
            status_code=403, detail="Requires treasurer or exco role in this association"
        )
    updated = disbursements_service.record_decision(session, request, membership, Decision.approved)
    session.commit()
    session.refresh(updated)
    if updated.status is DisbursementStatus.approved:
        association = session.get(Association, updated.association_id)
        background_tasks.add_task(_execute_and_broadcast, updated.id, association.id)
    return _disbursement_dict(session, updated)


@router.post("/disbursements/{disbursement_id}/reject")
def reject(
    disbursement_id: uuid.UUID,
    body: DecisionBody,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    request = _disbursement_or_404(session, disbursement_id)
    membership = role_in_association(session, user, request.association_id)
    if membership is None or membership.role not in (Role.treasurer, Role.exco):
        raise HTTPException(
            status_code=403, detail="Requires treasurer or exco role in this association"
        )
    if not body.password or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=403, detail="Password confirmation required to reject")
    updated = disbursements_service.record_decision(session, request, membership, Decision.rejected)
    session.commit()
    session.refresh(updated)
    return _disbursement_dict(session, updated)


async def _execute_and_broadcast(disbursement_id: uuid.UUID, association_id: uuid.UUID) -> None:
    """Background: run the Ecobank transfer for a threshold-met request."""
    from ..db import engine

    with Session(engine) as session:
        request = session.get(DisbursementRequest, disbursement_id)
        association = session.get(Association, association_id)
        if request is None or association is None:
            return
        try:
            updated = await disbursements_service.maybe_execute(session, request, association)
            session.commit()
        except HTTPException:
            return  # transfer failure logged inside the service; retried by job later
        session.refresh(updated)
        await disbursements_service.broadcast_decision(updated)


def _disbursement_dict(session: Session, request: DisbursementRequest) -> dict:
    approvals = session.exec(
        select(DisbursementApproval).where(DisbursementApproval.disbursement_id == request.id)
    ).all()
    association = session.get(Association, request.association_id)
    # Resolve display names while the session is open so the frontend never
    # needs a user-id → name lookup endpoint (no user directory exists).
    def name_of(user_id: uuid.UUID | None) -> str | None:
        if user_id is None:
            return None
        u = session.get(User, user_id)
        return u.name if u else None

    return {
        "id": str(request.id),
        "association_id": str(request.association_id),
        "requested_by": str(request.requested_by),
        "requested_by_name": name_of(request.requested_by),
        "amount": str(request.amount),
        "reason": request.reason,
        "recipient": request.recipient_details or {},
        "status": request.status.value,
        "ecobank_transaction_ref": request.ecobank_transaction_ref,
        "approvals": [
            {
                "approved_by": str(a.approved_by),
                "name": name_of(a.approved_by),
                "decision": a.decision.value,
                "timestamp": a.timestamp.isoformat(),
            }
            for a in approvals
        ],
        "approval_threshold": association.approval_threshold if association else None,
        "created_at": request.created_at.isoformat(),
    }
