"""Migration 0002 — per-level dues.

Adds the roster member's academic level and per-level cycle pricing, which the
frontend's dues wizard has always collected (spec 4.2: 100L can be billed
differently from 300L).
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_levels_and_per_level"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("member_record", sa.Column("level", sa.String(8), nullable=False, server_default="300L"))
    op.add_column("dues_cycle", sa.Column("per_level", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("dues_cycle", "per_level")
    op.drop_column("member_record", "level")
