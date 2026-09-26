"""Reconciliation service — we don't blindly trust our own database.

Compares the ledger's calculated balance against Ecobank's Account Enquiry
(authoritative source of truth). Drift gets flagged and audit-logged so a
missed webhook or delayed settlement is caught before a member notices.
"""

import logging
from decimal import Decimal

from sqlmodel import Session

from .. import audit as audit_service
from ..ecobank import EcobankError
from ..ecobank import client as ecobank_client
from ..models import Association, utcnow
from . import ledger as ledger_service

logger = logging.getLogger(__name__)

# Naira accounts settle in whole amounts; anything under a naira is noise.
DRIFT_TOLERANCE = Decimal("1.00")


def reconcile(session: Session, association: Association) -> dict:
    """Compare ledger balance to the Ecobank account enquiry balance."""
    ledger_balance = ledger_service.current_balance(session, association.id)

    if not association.treasury_account_ref:
        return {
            "association_id": str(association.id),
            "ledger_balance": str(ledger_balance),
            "ecobank_balance": None,
            "drift": None,
            "status": "not_linked",
            "message": "Association has not linked an Ecobank account yet",
        }

    try:
        live = ecobank_client.account_enquiry(association.treasury_account_ref)
    except EcobankError as exc:
        logger.warning("account enquiry failed for %s: %s", association.id, exc)
        return {
            "association_id": str(association.id),
            "ledger_balance": str(ledger_balance),
            "ecobank_balance": None,
            "drift": None,
            "status": "unavailable",
            "message": "Ecobank account enquiry unavailable — try again shortly",
        }

    drift = Decimal(str(live.balance)) - ledger_balance
    drifted = abs(drift) > DRIFT_TOLERANCE

    result = {
        "association_id": str(association.id),
        "ledger_balance": str(ledger_balance),
        "ecobank_balance": str(live.balance),
        "drift": str(drift),
        "status": "drifted" if drifted else "in_sync",
        "checked_at": utcnow().isoformat(),
    }
    if drifted:
        audit_service.audit(
            session,
            action="reconciliation_drift",
            actor_id=None,
            metadata={
                "association_id": str(association.id),
                "ledger_balance": str(ledger_balance),
                "ecobank_balance": str(live.balance),
                "drift": str(drift),
            },
        )
        session.commit()
    return result
