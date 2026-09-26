"""Ledger endpoints: paginated history, running balance, WebSocket live feed,
on-demand reconciliation."""

import uuid

from fastapi import (
    APIRouter,
    Depends,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from sqlmodel import Session, func, select

from ..db import get_session
from ..deps import require_association
from ..live import hub
from ..models import LedgerEntry
from ..security import decode_token
from ..services import ledger as ledger_service
from ..services import reconciliation as reconciliation_service

router = APIRouter(tags=["ledger"])


@router.get("/associations/{assoc_id}/ledger")
def ledger_feed(
    assoc_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _pair=Depends(require_association),
):
    """Paginated ledger feed (newest first) + current running balance."""
    entries = session.exec(
        select(LedgerEntry)
        .where(LedgerEntry.association_id == assoc_id)
        .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    total = session.exec(
        select(func.count()).select_from(LedgerEntry).where(LedgerEntry.association_id == assoc_id)
    ).one()
    return {
        "balance": str(ledger_service.current_balance(session, assoc_id)),
        "total": total,
        "items": [
            {
                "id": str(e.id),
                "type": e.type.value,
                "amount": str(e.amount),
                "reason_or_category": e.reason_or_category,
                "linked_payment_id": str(e.linked_payment_id) if e.linked_payment_id else None,
                "linked_disbursement_id": str(e.linked_disbursement_id)
                if e.linked_disbursement_id
                else None,
                "linked_entry_id": str(e.linked_entry_id) if e.linked_entry_id else None,
                "running_balance": str(e.running_balance),
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ],
    }


@router.websocket("/associations/{assoc_id}/ledger/live")
async def ledger_live(
    websocket: WebSocket,
    assoc_id: uuid.UUID,
    token: str = Query(...),
    session: Session = Depends(get_session),
):
    """WebSocket live ledger feed for an association.

    Auth is enforced before accept: the ``token`` query param must be a valid
    access token belonging to a member of this association.
    """
    import jwt as pyjwt

    from ..models import Membership, User

    try:
        payload = decode_token(token, expected_type="access")
    except pyjwt.PyJWTError:
        await websocket.close(code=4401)
        return
    user = session.get(User, uuid.UUID(payload["sub"]))
    membership = (
        session.exec(
            select(Membership).where(
                Membership.user_id == user.id, Membership.association_id == assoc_id
            )
        ).first()
        if user
        else None
    )
    if membership is None:
        await websocket.close(code=4403)
        return

    await hub.connect(assoc_id, websocket)
    try:
        # Send current balance immediately so the client can initialize.
        await websocket.send_json(
            {
                "event": "snapshot",
                "balance": str(ledger_service.current_balance(session, assoc_id)),
            }
        )
        while True:
            # Keep the socket open; broadcasts arrive asynchronously.
            await websocket.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect(assoc_id, websocket)


@router.get("/associations/{assoc_id}/balance/reconcile")
def reconcile_balance(
    assoc_id: uuid.UUID,
    membership=Depends(require_association),
    session: Session = Depends(get_session),
):
    """On-demand reconciliation: ledger balance vs Ecobank Account Enquiry."""
    assoc, _ = membership
    result = reconciliation_service.reconcile(session, assoc)
    session.commit()  # persist drift audit rows
    return result
