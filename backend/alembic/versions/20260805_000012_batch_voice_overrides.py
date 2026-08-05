"""persist per-language voice overrides for content batches

Revision ID: 20260805_000012
Revises: 20260805_000011
Create Date: 2026-08-05 00:00:12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260805_000012"
down_revision = "20260805_000011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "content_generation_batches",
        sa.Column("voice_overrides", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("content_generation_batches", "voice_overrides")
