"""Immutable audit trail — records human decisions, not money.

Every state-changing action lands here with actor + timestamp + metadata,
separate from the financial ledger (compliance layer).
"""

import logging
import uuid

from sqlmodel import Session

from .models import AuditLog, utcnow

logger = logging.getLogger(__name__)


def audit(
    session: Session,
    action: str,
    actor_id: uuid.UUID | None = None,
    metadata: dict | None = None,
    commit: bool = False,
) -> AuditLog:
    """Append an audit row. Joins the caller's transaction unless commit=True."""
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        meta=metadata or {},
        timestamp=utcnow(),
    )
    session.add(entry)
    if commit:
        session.commit()
    logger.info("audit: %s actor=%s meta=%s", action, actor_id, entry.meta)
    return entry
