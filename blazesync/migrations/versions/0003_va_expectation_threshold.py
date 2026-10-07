"""Migration 0003 — virtual accounts, expectation statements, DB threshold.

Three spec gaps closed at the schema layer:

1. ``member_record.virtual_account_ref`` — every roster member gets their own
   Ecobank virtual account when provisioning runs; incoming credits into it
   are attributable to that member without any manual matching.
2. ``dues_cycle.expectation_statement`` — what the money funds, written by the
   treasurer when the cycle opens; ``receipt.expectation_statement_snapshot``
   freezes the statement at payment time so the receipt keeps proving intent
   even if the cycle text is later edited.
3. A database constraint trigger on ``disbursement_request`` refuses any row
   in ``approved``/``completed`` state whose association holds fewer than
   ``approval_threshold`` DISTINCT approved DisbursementApproval rows —
   the multi-sig rule holds even against raw SQL, not just at the API layer.
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_va_expectation_threshold"
down_revision = "0002_levels_and_per_level"
branch_labels = None
depends_on = None


def upgrade() -> None:
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

    op.add_column(
        "dues_cycle",
        sa.Column("expectation_statement", sa.Text(), nullable=True),
    )
    op.add_column(
        "receipt",
        sa.Column("expectation_statement_snapshot", sa.Text(), nullable=True),
    )

    # --- DB-layer multi-signature enforcement -------------------------------
    op.execute(
        """
        CREATE OR REPLACE FUNCTION enforce_disbursement_threshold() RETURNS trigger AS $$
        DECLARE
            v_threshold INTEGER;
            v_distinct_approvals INTEGER;
        BEGIN
            IF NEW.status NOT IN ('approved', 'completed') THEN
                RETURN NEW;
            END IF;
            SELECT approval_threshold INTO v_threshold
            FROM association WHERE id = NEW.association_id;
            SELECT COUNT(DISTINCT approved_by) INTO v_distinct_approvals
            FROM disbursement_approval
            WHERE disbursement_id = NEW.id AND decision = 'approved';
            IF v_distinct_approvals < v_threshold THEN
                RAISE EXCEPTION
                    'disbursement % cannot be %: has % of % required approvals',
                    NEW.id, NEW.status, v_distinct_approvals, v_threshold
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER disbursement_threshold_guard
        AFTER INSERT OR UPDATE ON disbursement_request
        DEFERRABLE INITIALLY IMMEDIATE
        FOR EACH ROW EXECUTE FUNCTION enforce_disbursement_threshold();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS disbursement_threshold_guard ON disbursement_request"
    )
    op.execute("DROP FUNCTION IF EXISTS enforce_disbursement_threshold()")
    op.drop_column("receipt", "expectation_statement_snapshot")
    op.drop_column("dues_cycle", "expectation_statement")
    op.drop_index("ix_member_record_virtual_account_ref", table_name="member_record")
    op.execute("DROP INDEX IF EXISTS uq_member_record_virtual_account")
    op.drop_column("member_record", "virtual_account_ref")
