"""Initial BlazeSync schema.

Creates every table plus the append-only guarantee for the ledger: a BEFORE
UPDATE OR DELETE trigger on ledger_entry raises an exception, so history is
immutable even against raw SQL — not just at the API layer.
"""

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE role_enum AS ENUM ('treasurer', 'exco', 'member');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE invite_status_enum AS ENUM ('pending', 'sent', 'claimed', 'expired');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE cycle_status_enum AS ENUM ('active', 'closed');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE pay_channel_enum AS ENUM ('blaze', 'other', 'manual');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE pay_status_enum AS ENUM ('pending', 'success', 'failed');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE ledger_type_enum AS ENUM ('inflow', 'outflow');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE disb_status_enum AS ENUM ('pending', 'approved', 'rejected', 'completed');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE decision_enum AS ENUM ('approved', 'rejected');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )

    op.execute(
        """
        CREATE TABLE "user" (
            id UUID PRIMARY KEY,
            name VARCHAR NOT NULL,
            email VARCHAR NOT NULL UNIQUE,
            phone VARCHAR UNIQUE,
            password_hash VARCHAR NOT NULL,
            blaze_account_linked BOOLEAN NOT NULL DEFAULT false,
            linked_account_ref VARCHAR,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE association (
            id UUID PRIMARY KEY,
            name VARCHAR NOT NULL,
            institution VARCHAR NOT NULL,
            department_or_faculty VARCHAR NOT NULL,
            treasury_account_ref VARCHAR,
            created_by UUID NOT NULL REFERENCES "user"(id),
            approval_threshold INTEGER NOT NULL DEFAULT 2 CHECK (approval_threshold >= 1),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE membership (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES "user"(id),
            association_id UUID NOT NULL REFERENCES association(id),
            role role_enum NOT NULL,
            joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_membership UNIQUE (user_id, association_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE member_record (
            id UUID PRIMARY KEY,
            association_id UUID NOT NULL REFERENCES association(id),
            name VARCHAR NOT NULL,
            matric_number VARCHAR,
            email VARCHAR NOT NULL,
            phone VARCHAR,
            user_id UUID REFERENCES "user"(id),
            invite_code VARCHAR NOT NULL UNIQUE,
            invite_status invite_status_enum NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_member_record_assoc_email UNIQUE (association_id, email)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE dues_cycle (
            id UUID PRIMARY KEY,
            association_id UUID NOT NULL REFERENCES association(id),
            title VARCHAR NOT NULL,
            amount NUMERIC(18, 2) NOT NULL,
            deadline TIMESTAMP WITH TIME ZONE NOT NULL,
            created_by UUID NOT NULL REFERENCES "user"(id),
            status cycle_status_enum NOT NULL DEFAULT 'active',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE payment (
            id UUID PRIMARY KEY,
            dues_cycle_id UUID NOT NULL REFERENCES dues_cycle(id),
            member_record_id UUID NOT NULL REFERENCES member_record(id),
            amount NUMERIC(18, 2) NOT NULL,
            paid_via pay_channel_enum NOT NULL,
            ecobank_transaction_ref VARCHAR,
            status pay_status_enum NOT NULL,
            idempotency_key VARCHAR NOT NULL UNIQUE,
            timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE receipt (
            id UUID PRIMARY KEY,
            payment_id UUID NOT NULL REFERENCES payment(id),
            hash VARCHAR NOT NULL,
            generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE disbursement_request (
            id UUID PRIMARY KEY,
            association_id UUID NOT NULL REFERENCES association(id),
            requested_by UUID NOT NULL REFERENCES "user"(id),
            amount NUMERIC(18, 2) NOT NULL,
            reason VARCHAR NOT NULL,
            recipient_details JSONB NOT NULL DEFAULT '{}'::jsonb,
            status disb_status_enum NOT NULL DEFAULT 'pending',
            ecobank_transaction_ref VARCHAR,
            idempotency_key VARCHAR NOT NULL UNIQUE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE ledger_entry (
            id UUID PRIMARY KEY,
            association_id UUID NOT NULL REFERENCES association(id),
            type ledger_type_enum NOT NULL,
            amount NUMERIC(18, 2) NOT NULL,
            reason_or_category VARCHAR NOT NULL,
            linked_payment_id UUID REFERENCES payment(id),
            linked_disbursement_id UUID REFERENCES disbursement_request(id),
            linked_entry_id UUID REFERENCES ledger_entry(id),
            running_balance NUMERIC(18, 2) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE disbursement_approval (
            id UUID PRIMARY KEY,
            disbursement_id UUID NOT NULL REFERENCES disbursement_request(id),
            approved_by UUID NOT NULL REFERENCES "user"(id),
            decision decision_enum NOT NULL,
            timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_approval_one_vote UNIQUE (disbursement_id, approved_by)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE refresh_token (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES "user"(id),
            jti VARCHAR NOT NULL UNIQUE,
            revoked BOOLEAN NOT NULL DEFAULT false,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE audit_log (
            id UUID PRIMARY KEY,
            actor_id UUID REFERENCES "user"(id),
            action VARCHAR NOT NULL,
            "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
            timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )

    # --- Indexes ---
    op.execute('CREATE INDEX ix_user_name ON "user" (name)')
    op.execute('CREATE INDEX ix_user_email ON "user" (email)')
    op.execute('CREATE INDEX ix_user_phone ON "user" (phone)')
    op.execute("CREATE INDEX ix_membership_user_id ON membership (user_id)")
    op.execute("CREATE INDEX ix_membership_association_id ON membership (association_id)")
    op.execute("CREATE INDEX ix_membership_role ON membership (role)")
    op.execute("CREATE INDEX ix_member_record_association_id ON member_record (association_id)")
    op.execute("CREATE INDEX ix_member_record_name ON member_record (name)")
    op.execute("CREATE INDEX ix_member_record_matric_number ON member_record (matric_number)")
    op.execute("CREATE INDEX ix_member_record_email ON member_record (email)")
    op.execute("CREATE INDEX ix_member_record_user_id ON member_record (user_id)")
    op.execute("CREATE INDEX ix_member_record_invite_code ON member_record (invite_code)")
    op.execute("CREATE INDEX ix_member_record_invite_status ON member_record (invite_status)")
    op.execute("CREATE INDEX ix_duescycle_association_id ON dues_cycle (association_id)")
    op.execute("CREATE INDEX ix_duescycle_status ON dues_cycle (status)")
    op.execute("CREATE INDEX ix_payment_dues_cycle_id ON payment (dues_cycle_id)")
    op.execute("CREATE INDEX ix_payment_member_record_id ON payment (member_record_id)")
    op.execute(
        "CREATE INDEX ix_payment_ecobank_transaction_ref ON payment (ecobank_transaction_ref)"
    )
    op.execute("CREATE INDEX ix_payment_status ON payment (status)")
    op.execute("CREATE INDEX ix_payment_idempotency_key ON payment (idempotency_key)")
    op.execute("CREATE INDEX ix_receipt_payment_id ON receipt (payment_id)")
    op.execute("CREATE INDEX ix_receipt_hash ON receipt (hash)")
    op.execute("CREATE INDEX ix_ledger_entry_association_id ON ledger_entry (association_id)")
    op.execute("CREATE INDEX ix_ledger_entry_type ON ledger_entry (type)")
    op.execute("CREATE INDEX ix_ledger_entry_created_at ON ledger_entry (created_at)")
    op.execute(
        "CREATE INDEX ix_disbursement_request_association_id ON disbursement_request (association_id)"
    )
    op.execute("CREATE INDEX ix_disbursement_request_status ON disbursement_request (status)")
    op.execute(
        "CREATE INDEX ix_disbursement_request_idempotency_key ON disbursement_request (idempotency_key)"
    )
    op.execute(
        "CREATE INDEX ix_disbursement_approval_disbursement_id ON disbursement_approval (disbursement_id)"
    )
    op.execute(
        "CREATE INDEX ix_disbursement_approval_approved_by ON disbursement_approval (approved_by)"
    )
    op.execute("CREATE INDEX ix_refresh_token_user_id ON refresh_token (user_id)")
    op.execute("CREATE INDEX ix_refresh_token_jti ON refresh_token (jti)")
    op.execute("CREATE INDEX ix_refresh_token_revoked ON refresh_token (revoked)")
    op.execute("CREATE INDEX ix_audit_log_actor_id ON audit_log (actor_id)")
    op.execute("CREATE INDEX ix_audit_log_action ON audit_log (action)")
    op.execute("CREATE INDEX ix_audit_log_timestamp ON audit_log (timestamp)")

    # --- Append-only enforcement: the database itself refuses rewrites ---
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_ledger_rewrite() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'ledger_entry is append-only: % rejected', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER ledger_entry_append_only
        BEFORE UPDATE OR DELETE ON ledger_entry
        FOR EACH ROW EXECUTE FUNCTION prevent_ledger_rewrite();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS ledger_entry_append_only ON ledger_entry")
    op.execute("DROP FUNCTION IF EXISTS prevent_ledger_rewrite()")
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("DROP TABLE IF EXISTS refresh_token")
    op.execute("DROP TABLE IF EXISTS disbursement_approval")
    op.execute("DROP TABLE IF EXISTS disbursement_request")
    op.execute("DROP TABLE IF EXISTS ledger_entry")
    op.execute("DROP TABLE IF EXISTS receipt")
    op.execute("DROP TABLE IF EXISTS payment")
    op.execute("DROP TABLE IF EXISTS dues_cycle")
    op.execute("DROP TABLE IF EXISTS member_record")
    op.execute("DROP TABLE IF EXISTS membership")
    op.execute("DROP TABLE IF EXISTS association")
    op.execute('DROP TABLE IF EXISTS "user"')
    op.execute("DROP TYPE IF EXISTS decision_enum")
    op.execute("DROP TYPE IF EXISTS disb_status_enum")
    op.execute("DROP TYPE IF EXISTS ledger_type_enum")
    op.execute("DROP TYPE IF EXISTS pay_status_enum")
    op.execute("DROP TYPE IF EXISTS pay_channel_enum")
    op.execute("DROP TYPE IF EXISTS cycle_status_enum")
    op.execute("DROP TYPE IF EXISTS invite_status_enum")
    op.execute("DROP TYPE IF EXISTS role_enum")
