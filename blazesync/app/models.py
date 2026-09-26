"""BlazeSync data models.

Design notes
------------
- UUID primary keys everywhere (safe to expose, no enumeration).
- Money is Numeric(18, 2) — never floats.
- Every multi-tenant table is scoped by association_id (multi-tenancy from day one).
- LedgerEntry is append-only; the schema migration installs a database trigger
  that rejects UPDATE/DELETE, so the guarantee does not depend on app code.
- AuditLog.metadata is stored in a column literally named `metadata` (the spec's
  name) and surfaced in Python as `meta` to avoid clashing with SQLAlchemy's
  reserved `metadata` attribute on declarative models.
"""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, JSON, Numeric, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, Relationship, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


# --- Enums -------------------------------------------------------------------


class Role(enum.StrEnum):
    treasurer = "treasurer"
    exco = "exco"
    member = "member"


class InviteStatus(enum.StrEnum):
    pending = "pending"
    sent = "sent"
    claimed = "claimed"
    expired = "expired"


class CycleStatus(enum.StrEnum):
    active = "active"
    closed = "closed"


class PaymentChannel(enum.StrEnum):
    blaze = "blaze"
    other = "other"
    manual = "manual"


class PaymentStatus(enum.StrEnum):
    pending = "pending"
    success = "success"
    failed = "failed"


class LedgerType(enum.StrEnum):
    inflow = "inflow"
    outflow = "outflow"


class DisbursementStatus(enum.StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    completed = "completed"


class Decision(enum.StrEnum):
    approved = "approved"
    rejected = "rejected"


# --- Tables -------------------------------------------------------------------


class User(SQLModel, table=True):
    __tablename__ = "user"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    name: str = Field(index=True)
    email: str = Field(unique=True, index=True)
    phone: str | None = Field(default=None, unique=True, index=True)
    password_hash: str
    blaze_account_linked: bool = Field(default=False)
    linked_account_ref: str | None = None
    created_at: datetime = Field(default_factory=utcnow)

    memberships: list["Membership"] = Relationship(back_populates="user")
    refresh_tokens: list["RefreshToken"] = Relationship(back_populates="user")


class Association(SQLModel, table=True):
    __tablename__ = "association"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    name: str = Field(index=True)
    institution: str
    department_or_faculty: str
    treasury_account_ref: str | None = None  # from Ecobank consent flow
    created_by: uuid.UUID = Field(foreign_key="user.id")
    approval_threshold: int = Field(default=2, ge=1)
    created_at: datetime = Field(default_factory=utcnow)

    memberships: list["Membership"] = Relationship(back_populates="association")
    member_records: list["MemberRecord"] = Relationship(back_populates="association")
    dues_cycles: list["DuesCycle"] = Relationship(back_populates="association")
    ledger_entries: list["LedgerEntry"] = Relationship(back_populates="association")
    disbursements: list["DisbursementRequest"] = Relationship(back_populates="association")


class Membership(SQLModel, table=True):
    __tablename__ = "membership"
    __table_args__ = (UniqueConstraint("user_id", "association_id", name="uq_membership"),)

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    association_id: uuid.UUID = Field(foreign_key="association.id", index=True)
    role: Role = Field(
        sa_column=Column(
            SAEnum(Role, name="role_enum", native_enum=True), nullable=False, index=True
        )
    )
    joined_at: datetime = Field(default_factory=utcnow)

    user: User = Relationship(back_populates="memberships")
    association: Association = Relationship(back_populates="memberships")


class MemberRecord(SQLModel, table=True):
    """The roster — source of truth for who owes dues, independent of app signup."""

    __tablename__ = "member_record"
    __table_args__ = (
        UniqueConstraint("association_id", "email", name="uq_member_record_assoc_email"),
    )

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    association_id: uuid.UUID = Field(foreign_key="association.id", index=True)
    name: str = Field(index=True)
    matric_number: str | None = Field(default=None, index=True)
    email: str = Field(index=True)
    phone: str | None = None
    # Academic level used for per-level dues pricing ("100L"…"500L").
    level: str = Field(default="300L", sa_column=Column(String(8), nullable=False, server_default="300L"))
    user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    invite_code: str = Field(unique=True, index=True)
    invite_status: InviteStatus = Field(
        default=InviteStatus.pending,
        sa_column=Column(
            SAEnum(InviteStatus, name="invite_status_enum", native_enum=True),
            nullable=False,
            index=True,
        ),
    )
    created_at: datetime = Field(default_factory=utcnow)

    association: Association = Relationship(back_populates="member_records")
    user: "User" = Relationship()  # nullable until the invite is claimed
    payments: list["Payment"] = Relationship(back_populates="member_record")


class DuesCycle(SQLModel, table=True):
    __tablename__ = "dues_cycle"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    association_id: uuid.UUID = Field(foreign_key="association.id", index=True)
    title: str
    amount: float = Field(sa_column=Column(Numeric(18, 2), nullable=False))
    # Optional per-level overrides: {"100L": 2000, "300L": 5000}. When absent
    # every member pays the flat amount.
    per_level: dict | None = Field(default=None, sa_column=Column(JSON(), nullable=True))
    deadline: datetime
    created_by: uuid.UUID = Field(foreign_key="user.id")
    status: CycleStatus = Field(
        default=CycleStatus.active,
        sa_column=Column(
            SAEnum(CycleStatus, name="cycle_status_enum", native_enum=True),
            nullable=False,
            index=True,
        ),
    )
    created_at: datetime = Field(default_factory=utcnow)

    association: Association = Relationship(back_populates="dues_cycles")
    payments: list["Payment"] = Relationship(back_populates="dues_cycle")


class Payment(SQLModel, table=True):
    __tablename__ = "payment"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    dues_cycle_id: uuid.UUID = Field(foreign_key="dues_cycle.id", index=True)
    member_record_id: uuid.UUID = Field(foreign_key="member_record.id", index=True)
    amount: float = Field(sa_column=Column(Numeric(18, 2), nullable=False))
    paid_via: PaymentChannel = Field(
        sa_column=Column(
            SAEnum(PaymentChannel, name="pay_channel_enum", native_enum=True), nullable=False
        )
    )
    ecobank_transaction_ref: str | None = Field(default=None, index=True)
    status: PaymentStatus = Field(
        sa_column=Column(
            SAEnum(PaymentStatus, name="pay_status_enum", native_enum=True),
            nullable=False,
            index=True,
        )
    )
    idempotency_key: str = Field(unique=True, index=True)
    timestamp: datetime = Field(default_factory=utcnow)

    dues_cycle: DuesCycle = Relationship(back_populates="payments")
    member_record: MemberRecord = Relationship(back_populates="payments")
    receipts: list["Receipt"] = Relationship(back_populates="payment")


class Receipt(SQLModel, table=True):
    __tablename__ = "receipt"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    payment_id: uuid.UUID = Field(foreign_key="payment.id", index=True)
    # Deterministic hash of payer_id + amount + timestamp + association_id + transaction_ref
    hash: str = Field(index=True)
    generated_at: datetime = Field(default_factory=utcnow)

    payment: Payment = Relationship(back_populates="receipts")


class LedgerEntry(SQLModel, table=True):
    """APPEND-ONLY — never updated or deleted; corrections are new linked entries.

    The migration installs a BEFORE UPDATE/DELETE trigger that raises, so the
    guarantee holds even against raw SQL.
    """

    __tablename__ = "ledger_entry"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    association_id: uuid.UUID = Field(foreign_key="association.id", index=True)
    type: LedgerType = Field(
        sa_column=Column(
            SAEnum(LedgerType, name="ledger_type_enum", native_enum=True),
            nullable=False,
            index=True,
        )
    )
    amount: float = Field(sa_column=Column(Numeric(18, 2), nullable=False))
    reason_or_category: str = Field(index=True)
    linked_payment_id: uuid.UUID | None = Field(default=None, foreign_key="payment.id")
    linked_disbursement_id: uuid.UUID | None = Field(
        default=None, foreign_key="disbursement_request.id"
    )
    linked_entry_id: uuid.UUID | None = Field(
        default=None, foreign_key="ledger_entry.id"
    )  # corrections link back
    running_balance: float = Field(sa_column=Column(Numeric(18, 2), nullable=False))
    created_at: datetime = Field(default_factory=utcnow, index=True)

    association: Association = Relationship(back_populates="ledger_entries")


class DisbursementRequest(SQLModel, table=True):
    __tablename__ = "disbursement_request"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    association_id: uuid.UUID = Field(foreign_key="association.id", index=True)
    requested_by: uuid.UUID = Field(foreign_key="user.id")
    amount: float = Field(sa_column=Column(Numeric(18, 2), nullable=False))
    reason: str
    recipient_details: dict = Field(
        default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}")
    )
    status: DisbursementStatus = Field(
        default=DisbursementStatus.pending,
        sa_column=Column(
            SAEnum(DisbursementStatus, name="disb_status_enum", native_enum=True),
            nullable=False,
            index=True,
        ),
    )
    ecobank_transaction_ref: str | None = Field(default=None, index=True)
    idempotency_key: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utcnow)

    association: Association = Relationship(back_populates="disbursements")
    approvals: list["DisbursementApproval"] = Relationship(back_populates="disbursement")


class DisbursementApproval(SQLModel, table=True):
    __tablename__ = "disbursement_approval"
    __table_args__ = (
        UniqueConstraint("disbursement_id", "approved_by", name="uq_approval_one_vote"),
    )

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    disbursement_id: uuid.UUID = Field(foreign_key="disbursement_request.id", index=True)
    approved_by: uuid.UUID = Field(foreign_key="user.id", index=True)
    decision: Decision = Field(
        sa_column=Column(SAEnum(Decision, name="decision_enum", native_enum=True), nullable=False)
    )
    timestamp: datetime = Field(default_factory=utcnow)

    disbursement: DisbursementRequest = Relationship(back_populates="approvals")


class RefreshToken(SQLModel, table=True):
    """Server-side refresh tokens — revocable on logout (explainable auth)."""

    __tablename__ = "refresh_token"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    jti: str = Field(unique=True, index=True)  # JWT ID claim
    revoked: bool = Field(default=False, index=True)
    expires_at: datetime
    created_at: datetime = Field(default_factory=utcnow)

    user: User = Relationship(back_populates="refresh_tokens")


class AuditLog(SQLModel, table=True):
    """Action log — records decisions, not money. Separate from LedgerEntry."""

    __tablename__ = "audit_log"

    id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
    actor_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    action: str = Field(index=True)
    # Stored in a column literally named `metadata`; exposed as `meta` in Python
    # to avoid clashing with SQLAlchemy's reserved attribute.
    meta: dict = Field(
        default_factory=dict,
        sa_column=Column("metadata", JSONB, nullable=False, server_default="{}"),
    )
    timestamp: datetime = Field(default_factory=utcnow, index=True)
