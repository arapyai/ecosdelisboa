"""add automatic translation approval to content batches

Revision ID: 20260805_000013
Revises: 20260805_000012
Create Date: 2026-08-05 00:00:13
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260805_000013"
down_revision = "20260805_000012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "content_generation_batches",
        sa.Column(
            "auto_approve_translations",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("content_generation_batches", "auto_approve_translations")
