"""Audit log feed — the records screen's activity log and CSV handover pack."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, func, select

from ..db import get_session
from ..deps import require_association
from ..models import AuditLog, User

router = APIRouter(tags=["audit"])


def _summary(action: str, meta: dict) -> str:
    """A human line from the structured metadata, matching each audit call."""
    m = meta or {}
    if action == "association_created":
        return f"Created the association {m.get('name', '')}".strip()
    if action == "account_linked":
        return f"Linked the Ecobank account {m.get('account_ref', '')}".strip()
    if action == "exco_invited":
        return f"Invited {m.get('invitee', '')} as a co-signatory".strip()
    if action == "roster_uploaded":
        return f"Uploaded a roster ({m.get('created', 0)} members, {m.get('skipped', 0)} skipped)"
    if action == "invites_sent":
        return f"Sent {m.get('count', 0)} invite(s)"
    if action == "manual_payment_recorded":
        return f"Recorded a manual payment of {m.get('amount', '')}"
    if action == "dues_cycle_created":
        return f"Opened {m.get('title', '')} ({m.get('amount', '')})"
    if action == "dues_cycle_updated":
        changes = ", ".join(f"{k}={v}" for k, v in m.items() if k != "cycle_id")
        return f"Updated the dues cycle: {changes}" if changes else "Updated the dues cycle"
    if action == "dues_paid":
        return f"Dues payment {m.get('status', '')} (payment {str(m.get('payment_id', ''))[:8]})"
    if action == "invite_claimed":
        return "Claimed a roster invite"
    if action == "disbursement_requested":
        return f"Requested {m.get('amount', '')} for {m.get('reason', '')}".strip()
    if action == "disbursement_approved":
        return f"Approved {m.get('amount', '')} for {m.get('reason', '')}".strip()
    if action == "disbursement_rejected":
        return f"Rejected {m.get('amount', '')} for {m.get('reason', '')}".strip()
    if action == "disbursement_completed":
        return "Ecobank confirmed the payout".strip()
    if action == "reconciliation_run":
        return f"Reconciliation: {m.get('status', '')}"
    return action.replace("_", " ")


@router.get("/associations/{assoc_id}/audit")
def audit_feed(
    assoc_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    pair=Depends(require_association),
    session: Session = Depends(get_session),
):
    """Paginated activity log for an association (any member may read it)."""
    _assoc, _membership = pair  # membership checked; the log is read-only transparency
    assoc_str = str(assoc_id)
    rows = session.exec(
        select(AuditLog, User)
        .join(User, User.id == AuditLog.actor_id, isouter=True)
        .where(AuditLog.meta["association_id"].as_string() == assoc_str)
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        "total": session.exec(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.meta["association_id"].as_string() == assoc_str)
        ).one(),
        "items": [
            {
                "id": str(a.id),
                "actor_id": str(a.actor_id) if a.actor_id else None,
                "actor_name": u.name if u else "system",
                "action": a.action,
                "summary": _summary(a.action, a.meta),
                "metadata": a.meta or {},
                "timestamp": a.timestamp.isoformat(),
            }
            for a, u in rows
        ],
    }
