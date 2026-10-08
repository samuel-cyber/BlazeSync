"""Roster service — who owes dues, independent of app signup.

CSV/Excel import → MemberRecord rows with single-use cryptographically random
invite codes; claiming requires the email/phone on the request to match the
record; the roster view joins claim status with payment status per cycle.
"""

import csv
import io
import logging
import secrets
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlmodel import Session, select

from ..config import settings
from ..ecobank import EcobankError
from ..ecobank import client as ecobank_client
from ..models import (
    AccountOpeningStatus,
    DirectDebitMandate,
    DirectDebitStatus,
    DuesCycle,
    InviteStatus,
    MemberRecord,
    Membership,
    Payment,
    PaymentStatus,
    Role,
    User,
    utcnow,
)

logger = logging.getLogger(__name__)

# Cryptographically random, single-use, non-sequential — safe to share as a link.
CODE_BYTES = 12  # → 24-char url-safe token


def generate_invite_code() -> str:
    return secrets.token_urlsafe(CODE_BYTES)


def parse_roster(content: bytes, filename: str) -> list[dict]:
    """Accept CSV or XLSX; return rows with name/email/phone/matric keys."""
    name = filename.lower()
    if name.endswith(".xlsx"):
        return _parse_xlsx(content)
    if name.endswith((".csv", ".txt")) or True:  # default to CSV
        text = content.decode("utf-8-sig")  # tolerate BOM from Excel exports
        reader = csv.DictReader(io.StringIO(text))
        return [
            {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            for row in reader
            if any((v or "").strip() for v in row.values())
        ]


def _parse_xlsx(content: bytes) -> list[dict]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [(str(h or "").strip().lower()) for h in rows[0]]
    parsed = []
    for row in rows[1:]:
        if not any(value is not None and str(value).strip() for value in row):
            continue
        record = {}
        for header, value in zip(headers, row, strict=False):
            record[header] = str(value).strip() if value is not None else ""
        parsed.append(record)
    return parsed


def import_roster(
    session: Session,
    association_id: uuid.UUID,
    rows: list[dict],
    actor_id: uuid.UUID,
) -> list[MemberRecord]:
    """Upsert roster rows into MemberRecords with fresh invite codes."""
    created: list[MemberRecord] = []
    skipped: list[str] = []
    for row in rows:
        email = (row.get("email") or "").strip().lower()
        full_name = (row.get("name") or row.get("full_name") or row.get("fullname") or "").strip()
        if not email or not full_name:
            skipped.append(str(row))
            continue
        existing = session.exec(
            select(MemberRecord).where(
                MemberRecord.association_id == association_id,
                MemberRecord.email == email,
            )
        ).first()
        if existing:
            # Refresh name/matric/phone/level on re-upload, keep invite state.
            existing.name = full_name
            existing.matric_number = (
                row.get("matric_number") or row.get("matric") or existing.matric_number
            )
            existing.phone = row.get("phone") or existing.phone
            existing.level = (
                row.get("level") or existing.level
            )
            session.add(existing)
            continue

        record = MemberRecord(
            association_id=association_id,
            name=full_name,
            matric_number=row.get("matric_number") or row.get("matric") or None,
            email=email,
            phone=row.get("phone") or None,
            level=row.get("level") or "300L",
            invite_code=generate_invite_code(),
            invite_status=InviteStatus.pending,
        )
        session.add(record)
        created.append(record)
    session.flush()

    from .. import audit as audit_service

    audit_service.audit(
        session,
        action="roster_uploaded",
        actor_id=actor_id,
        metadata={
            "association_id": str(association_id),
            "created": len(created),
            "skipped": len(skipped),
        },
    )
    return created


def open_account(
    session: Session,
    member_record: MemberRecord,
    actor_id: uuid.UUID | None,
) -> dict:
    """Open a real Ecobank account for one roster member (Account Opening).

    Idempotent: a member already ``opened`` (or mid-flight ``opening_pending``)
    is left untouched. The sandbox may confirm synchronously (status becomes
    ``opened`` and the account ref is stored) or asynchronously (status stays
    ``opening_pending`` until a notification event completes it).
    """
    from .. import audit as audit_service

    if member_record.account_status is AccountOpeningStatus.opened:
        return {
            "member_record_id": str(member_record.id),
            "account_status": member_record.account_status.value,
            "account_ref": member_record.linked_account_ref,
            "skipped": True,
        }
    if member_record.account_status is AccountOpeningStatus.opening_pending:
        return {
            "member_record_id": str(member_record.id),
            "account_status": member_record.account_status.value,
            "account_ref": member_record.linked_account_ref,
            "skipped": True,
        }

    result = ecobank_client.open_account(
        member_name=member_record.name,
        customer_ref=f"{member_record.association_id}:{member_record.id}",
    )
    if result.success and result.status == "opened" and result.account_number:
        member_record.linked_account_ref = result.account_number
        member_record.account_status = AccountOpeningStatus.opened
    elif result.success:
        # Provider accepted the request but is provisioning asynchronously.
        member_record.account_status = AccountOpeningStatus.opening_pending
    else:
        raise HTTPException(
            status_code=502,
            detail=f"Ecobank account opening failed: {result.message or 'provider unavailable'}",
        )
    session.add(member_record)
    session.flush()
    audit_service.audit(
        session,
        action="account_opened",
        actor_id=actor_id,
        metadata={
            "association_id": str(member_record.association_id),
            "member_record_id": str(member_record.id),
            "account_status": member_record.account_status.value,
            "account_ref": member_record.linked_account_ref,
        },
    )
    return {
        "member_record_id": str(member_record.id),
        "account_status": member_record.account_status.value,
        "account_ref": member_record.linked_account_ref,
        "skipped": False,
    }


def authorize_direct_debit(
    session: Session,
    member_record: MemberRecord,
    actor_id: uuid.UUID | None,
) -> dict:
    """Register the member's direct-debit mandate (Payment From Ecobank Account).

    Requires an opened account. Creates (or reuses) the member's single mandate
    row and marks it ``active`` once the provider confirms authorization; a
    provider that returns ``pending`` leaves the mandate awaiting the member's
    confirmation (completed later by a notification event).
    """
    from .. import audit as audit_service

    if member_record.account_status is not AccountOpeningStatus.opened:
        raise HTTPException(
            status_code=409,
            detail="Open the member's Ecobank account before authorizing direct debit",
        )
    if not member_record.linked_account_ref:
        raise HTTPException(status_code=409, detail="Member has no linked account")

    mandate = session.exec(
        select(DirectDebitMandate).where(
            DirectDebitMandate.member_record_id == member_record.id
        )
    ).first()

    if mandate is not None and mandate.status is DirectDebitStatus.active:
        return {
            "member_record_id": str(member_record.id),
            "mandate_ref": mandate.mandate_ref,
            "status": mandate.status.value,
            "skipped": True,
        }

    try:
        result = ecobank_client.authorize_direct_debit(
            account_ref=member_record.linked_account_ref,
            reference=f"{member_record.association_id}:{member_record.id}",
        )
    except EcobankError as exc:
        raise HTTPException(
            status_code=502, detail="Ecobank mandate authorization unavailable"
        ) from exc

    if not result.success or not result.mandate_ref:
        raise HTTPException(
            status_code=502,
            detail=f"Mandate authorization failed: {result.message or 'provider unavailable'}",
        )

    status = (
        DirectDebitStatus.active
        if result.status == "active"
        else DirectDebitStatus.pending
    )
    if mandate is None:
        mandate = DirectDebitMandate(
            member_record_id=member_record.id,
            account_ref=member_record.linked_account_ref,
            mandate_ref=result.mandate_ref,
            status=status,
            authorized_at=utcnow() if status is DirectDebitStatus.active else None,
        )
    else:
        mandate.mandate_ref = result.mandate_ref
        mandate.account_ref = member_record.linked_account_ref
        mandate.status = status
        mandate.authorized_at = utcnow() if status is DirectDebitStatus.active else None
    session.add(mandate)
    session.flush()
    audit_service.audit(
        session,
        action="direct_debit_authorized",
        actor_id=actor_id,
        metadata={
            "association_id": str(member_record.association_id),
            "member_record_id": str(member_record.id),
            "mandate_ref": mandate.mandate_ref,
            "status": mandate.status.value,
        },
    )
    return {
        "member_record_id": str(member_record.id),
        "mandate_ref": mandate.mandate_ref,
        "status": mandate.status.value,
        "skipped": False,
    }


def send_invites(
    session: Session,
    association_id: uuid.UUID,
) -> int:
    """Mark pending invites as sent (background job sends email/SMS here).

    The actual delivery adapter is intentionally a stub: wire SendGrid,
    Termii, or Africa's Talking into _deliver() without touching flow logic.
    """
    records = session.exec(
        select(MemberRecord).where(
            MemberRecord.association_id == association_id,
            MemberRecord.invite_status == InviteStatus.pending,
        )
    ).all()
    for record in records:
        _deliver(record)  # background-friendly: no network in mock mode
        record.invite_status = InviteStatus.sent
        session.add(record)
    session.flush()
    return len(records)


def _deliver(record: MemberRecord) -> None:
    logger.info("[invite] %s → code %s (email=%s)", record.name, record.invite_code, record.email)


def claim_invite(
    session: Session, user: User, invite_code: str, email: str | None, phone: str | None
) -> MemberRecord:
    """Single-use claim linking an app account to a roster record.

    Requires identity match (email or phone must equal what the invite was
    sent to); expires after the configured window; marks the record claimed.
    """
    record = session.exec(
        select(MemberRecord).where(MemberRecord.invite_code == invite_code)
    ).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Invite code not found")
    if record.invite_status in (InviteStatus.claimed, InviteStatus.expired):
        raise HTTPException(status_code=409, detail="This invite has already been used")

    if utcnow() > record.created_at + timedelta(days=settings.INVITE_EXPIRY_DAYS):
        record.invite_status = InviteStatus.expired
        session.add(record)
        raise HTTPException(status_code=410, detail="This invite has expired")

    identity_matches = (email and email.strip().lower() == record.email) or (
        phone and phone.strip() == (record.phone or "")
    )
    if not identity_matches:
        raise HTTPException(status_code=403, detail="Email or phone does not match this invite")

    if record.user_id is not None and record.user_id != user.id:
        raise HTTPException(
            status_code=409, detail="Roster entry already claimed by another account"
        )

    record.user_id = user.id
    record.invite_status = InviteStatus.claimed
    session.add(record)

    # A claimed roster member joins the association as a plain member —
    # this gates every member view (shared ledger, WebSocket, receipts).
    membership = session.exec(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.association_id == record.association_id,
        )
    ).first()
    if membership is None:
        session.add(
            Membership(
                user_id=user.id, association_id=record.association_id, role=Role.member
            )
        )

    from .. import audit as audit_service

    audit_service.audit(
        session,
        action="invite_claimed",
        actor_id=user.id,
        metadata={"member_record_id": str(record.id), "association_id": str(record.association_id)},
    )

    # Step 4 onboarding — best-effort so a provider hiccup never fails the
    # claim. Open the member's Ecobank account, then (once it is live)
    # authorize the direct-debit mandate; only an active mandate later lets
    # the member be pulled for automatic dues collection.
    try:
        if record.account_status is AccountOpeningStatus.none:
            open_account(session, record, actor_id=user.id)
        if record.account_status is AccountOpeningStatus.opened:
            authorize_direct_debit(session, record, actor_id=user.id)
    except HTTPException as exc:
        logger.warning(
            "onboarding incomplete for member %s (claim still succeeds): %s",
            record.id,
            exc.detail,
        )
    return record


def roster_view(
    session: Session, association_id: uuid.UUID, active_cycle: DuesCycle | None
) -> list[dict]:
    """Roster rows joined with claim status + payment status for the active cycle."""
    records = session.exec(
        select(MemberRecord)
        .where(MemberRecord.association_id == association_id)
        .order_by(MemberRecord.name)
    ).all()
    paid_member_ids: set[uuid.UUID] = set()
    if active_cycle:
        payments = session.exec(
            select(Payment).where(
                Payment.dues_cycle_id == active_cycle.id,
                Payment.status == PaymentStatus.success,
            )
        ).all()
        paid_member_ids = {p.member_record_id for p in payments}

    mandates = (
        {
            m.member_record_id: m
            for m in session.exec(
                select(DirectDebitMandate).where(
                    DirectDebitMandate.member_record_id.in_([r.id for r in records])
                )
            ).all()
        }
        if records
        else {}
    )

    items = []
    for record in records:
        user = session.get(User, record.user_id) if record.user_id else None
        mandate = mandates.get(record.id)
        items.append(
            {
                "id": str(record.id),
                "name": record.name,
                "matric_number": record.matric_number,
                "email": record.email,
                "phone": record.phone,
                "claimed": record.user_id is not None,
                "claimed_by": user.name if user else None,
                "claimed_by_id": str(record.user_id) if record.user_id else None,
                "level": record.level,
                "linked_account_ref": record.linked_account_ref,
                "account_status": record.account_status.value,
                "mandate_status": mandate.status.value if mandate else None,
                "mandate_ref": mandate.mandate_ref if mandate else None,
                "invite_status": record.invite_status.value,
                "paid": record.id in paid_member_ids if active_cycle else None,
            }
        )
    return items
