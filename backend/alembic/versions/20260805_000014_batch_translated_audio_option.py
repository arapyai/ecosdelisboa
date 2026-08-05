"""persist translated audio option on content batches

Revision ID: 20260805_000014
Revises: 20260805_000013
Create Date: 2026-08-05 00:00:14
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260805_000014"
down_revision = "20260805_000013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "content_generation_batches",
        sa.Column(
            "generate_translated_audio",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("content_generation_batches", "generate_translated_audio")
