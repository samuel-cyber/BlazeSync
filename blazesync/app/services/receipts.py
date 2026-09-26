"""Receipt service — deterministic, independently recomputable hashes.

receipt.hash = SHA-256(payer_id | amount | timestamp | association_id |
transaction_ref). Anyone holding the stored fields can recompute the hash and
confirm the receipt wasn't tampered with — the demo's "prove it" moment.
"""

import hashlib
import hmac
import uuid
from decimal import Decimal

from sqlmodel import Session, select

from ..models import Payment, Receipt


def compute_receipt_hash(
    payer_id: uuid.UUID,
    amount: Decimal,
    timestamp_iso: str,
    association_id: uuid.UUID,
    transaction_ref: str | None,
) -> str:
    canonical = "|".join(
        [
            str(payer_id),
            f"{amount:.2f}",
            timestamp_iso,
            str(association_id),
            transaction_ref or "",
        ]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def payer_id_for(payment: Payment) -> uuid.UUID:
    """The payer identity is the roster member's user if claimed, else the roster record."""
    return payment.member_record.user_id or payment.member_record_id


def generate_receipt(session: Session, payment: Payment) -> Receipt:
    receipt = Receipt(
        payment_id=payment.id,
        hash=compute_receipt_hash(
            payer_id=payer_id_for(payment),
            amount=Decimal(str(payment.amount)),
            timestamp_iso=payment.timestamp.isoformat(),
            association_id=payment.dues_cycle.association_id,
            transaction_ref=payment.ecobank_transaction_ref,
        ),
    )
    session.add(receipt)
    session.flush()
    return receipt


def verify_receipt(session: Session, payment: Payment) -> dict:
    """Recompute the hash from stored fields and compare — returns verified flag."""
    receipt = session.exec(
        select(Receipt)
        .where(Receipt.payment_id == payment.id)
        .order_by(Receipt.generated_at.desc())
    ).first()
    if receipt is None:
        return {"receipt": None, "verified": False, "reason": "no receipt issued"}
    expected = compute_receipt_hash(
        payer_id=payer_id_for(payment),
        amount=Decimal(str(payment.amount)),
        timestamp_iso=payment.timestamp.isoformat(),
        association_id=payment.dues_cycle.association_id,
        transaction_ref=payment.ecobank_transaction_ref,
    )
    return {
        "receipt_id": str(receipt.id),
        "hash": receipt.hash,
        "recomputed_hash": expected,
        "verified": hmac.compare_digest(receipt.hash, expected),
    }
