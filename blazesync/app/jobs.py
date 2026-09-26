"""Background jobs (FastAPI lifespan).

The MVP uses in-process background loops; the job functions are deliberately
plain and side-effect isolated so a Celery worker can adopt them verbatim.
"""

import asyncio
import logging

from fastapi import FastAPI
from sqlmodel import Session, select

from .config import settings
from .db import engine
from .models import Association
from .services import reconciliation as reconciliation_service

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None


async def reconciliation_loop() -> None:
    """Periodically reconcile every linked association's balance."""
    interval = max(settings.RECONCILE_INTERVAL_SECONDS, 30)
    while True:
        try:
            await asyncio.sleep(interval)
            with Session(engine) as session:
                associations = session.exec(
                    select(Association).where(Association.treasury_account_ref.is_not(None))
                ).all()
                for association in associations:
                    try:
                        result = reconciliation_service.reconcile(session, association)
                        session.commit()
                        if result["status"] == "drifted":
                            logger.warning(
                                "reconciliation drift for %s: %s",
                                association.id,
                                result["drift"],
                            )
                    except Exception:
                        logger.exception("reconciliation failed for %s", association.id)
        except asyncio.CancelledError:
            logger.info("reconciliation loop cancelled — shutting down")
            return


def start_jobs(app: FastAPI) -> None:
    global _task
    if settings.RECONCILE_INTERVAL_SECONDS > 0:
        _task = asyncio.create_task(reconciliation_loop())
        logger.info("reconciliation loop started (every %ss)", settings.RECONCILE_INTERVAL_SECONDS)


def stop_jobs() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        _task = None
