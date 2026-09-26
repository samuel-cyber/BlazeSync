"""Append-only ledger service.

Running balances are computed at insert time and serialized per association
with a transaction-scoped Postgres advisory lock, so two concurrent payments
can never interleave balance calculations. Entries are never updated or
deleted — the database trigger enforces that; corrections are new entries
linked to the original via ``linked_entry_id``.
"""

import uuid
from decimal import Decimal

from sqlalchemy import text
from sqlmodel import Session, select

from ..models import LedgerEntry, LedgerType, utcnow


def current_balance(session: Session, association_id: uuid.UUID) -> Decimal:
    """Latest running balance for the association (zero if no entries yet)."""
    entry = session.exec(
        select(LedgerEntry)
        .where(LedgerEntry.association_id == association_id)
        .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc())
    ).first()
    return Decimal(str(entry.running_balance)) if entry else Decimal("0.00")


def append_entry(
    session: Session,
    association_id: uuid.UUID,
    type_: LedgerType,
    amount: Decimal,
    reason_or_category: str,
    linked_payment_id: uuid.UUID | None = None,
    linked_disbursement_id: uuid.UUID | None = None,
    linked_entry_id: uuid.UUID | None = None,
) -> LedgerEntry:
    """Insert the next ledger entry, computing the running balance atomically."""
    # Serialize balance computation per association for this transaction.
    session.exec(
        text("SELECT pg_advisory_xact_lock(hashtext(:aid))").bindparams(aid=str(association_id))
    )
    balance = current_balance(session, association_id)
    signed = amount if type_ is LedgerType.inflow else -amount
    entry = LedgerEntry(
        association_id=association_id,
        type=type_,
        amount=amount,
        reason_or_category=reason_or_category,
        linked_payment_id=linked_payment_id,
        linked_disbursement_id=linked_disbursement_id,
        linked_entry_id=linked_entry_id,
        running_balance=balance + signed,
        created_at=utcnow(),
    )
    session.add(entry)
    session.flush()  # assign id + created_at before caller broadcasts/commits
    return entry
