"""Migration 0004 — account opening + direct-debit mandates.

Replaces the virtual-account model with Ecobank's Account Opening Service and
"Payment From Ecobank Account" (direct debit):

1. ``member_record.virtual_account_ref`` is dropped — we no longer push money
   into per-member virtual accounts.
2. ``member_record.linked_account_ref`` + ``member_record.account_status`` are
   added: the member's own opened Ecobank account and where it is in the
   opening lifecycle (none → opening_pending → opened).
3. ``direct_debit_mandate`` is created: one active mandate per member
   authorizes us to pull dues from their account. Only an ``active`` mandate
   may be debited — the enforcement point for "no mandate, no collection".

Everything else from 0003 (expectation statements, the DB threshold trigger)
is untouched.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_account_opening_dd"
down_revision = "0003_va_expectation_threshold"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # --- 1. Retire the virtual-account column ------------------------------
    op.drop_index("ix_member_record_virtual_account_ref", table_name="member_record")
    op.execute("DROP INDEX IF EXISTS uq_member_record_virtual_account")
    op.drop_column("member_record", "virtual_account_ref")

    # --- 2. Member's own opened account + opening lifecycle ----------------
    op.add_column(
        "member_record",
        sa.Column("linked_account_ref", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_member_record_linked_account_ref",
        "member_record",
        ["linked_account_ref"],
    )

    op.execute(
        "CREATE TYPE account_opening_status_enum "
        "AS ENUM ('none', 'opening_pending', 'opened')"
    )
    account_status_enum = postgresql.ENUM(
        "none",
        "opening_pending",
        "opened",
        name="account_opening_status_enum",
        create_type=False,
    )
    op.add_column(
        "member_record",
        sa.Column(
            "account_status",
            account_status_enum,
            nullable=False,
            server_default="none",
        ),
    )
    op.create_index(
        "ix_member_record_account_status",
        "member_record",
        ["account_status"],
    )

    # --- 3. Direct-debit mandates ------------------------------------------
    op.execute(
        "CREATE TYPE direct_debit_status_enum "
        "AS ENUM ('pending', 'active', 'revoked')"
    )
    direct_debit_status_enum = postgresql.ENUM(
        "pending",
        "active",
        "revoked",
        name="direct_debit_status_enum",
        create_type=False,
    )
    op.create_table(
        "direct_debit_mandate",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "member_record_id",
            sa.Uuid(),
            sa.ForeignKey("member_record.id"),
            nullable=False,
        ),
        sa.Column("account_ref", sa.String(), nullable=False),
        sa.Column("mandate_ref", sa.String(), nullable=False),
        sa.Column("status", direct_debit_status_enum, nullable=False),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_record_id", name="uq_direct_debit_mandate_member"),
    )
    op.create_index(
        "ix_direct_debit_mandate_member_record_id",
        "direct_debit_mandate",
        ["member_record_id"],
    )
    op.create_index(
        "ix_direct_debit_mandate_account_ref",
        "direct_debit_mandate",
        ["account_ref"],
    )
    op.create_index(
        "ix_direct_debit_mandate_mandate_ref",
        "direct_debit_mandate",
        ["mandate_ref"],
        unique=True,
    )
    op.create_index(
        "ix_direct_debit_mandate_status",
        "direct_debit_mandate",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_direct_debit_mandate_status", table_name="direct_debit_mandate")
    op.drop_index("ix_direct_debit_mandate_mandate_ref", table_name="direct_debit_mandate")
    op.drop_index("ix_direct_debit_mandate_account_ref", table_name="direct_debit_mandate")
    op.drop_index(
        "ix_direct_debit_mandate_member_record_id", table_name="direct_debit_mandate"
    )
    op.drop_table("direct_debit_mandate")
    op.execute("DROP TYPE IF EXISTS direct_debit_status_enum")

    op.drop_index("ix_member_record_account_status", table_name="member_record")
    op.drop_column("member_record", "account_status")
    op.execute("DROP TYPE IF EXISTS account_opening_status_enum")
    op.drop_index("ix_member_record_linked_account_ref", table_name="member_record")
    op.drop_column("member_record", "linked_account_ref")

    # Restore the virtual-account column exactly as 0003 left it.
    op.add_column(
        "member_record",
        sa.Column("virtual_account_ref", sa.String(64), nullable=True),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_member_record_virtual_account "
        "ON member_record (virtual_account_ref) WHERE virtual_account_ref IS NOT NULL"
    )
    op.create_index(
        "ix_member_record_virtual_account_ref",
        "member_record",
        ["virtual_account_ref"],
    )
