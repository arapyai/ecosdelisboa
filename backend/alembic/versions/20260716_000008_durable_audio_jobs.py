"""persist audio worker input and queue index

Revision ID: 20260716_000008
Revises: 20260716_000007
Create Date: 2026-07-16 00:00:08
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260716_000008"
down_revision = "20260716_000007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audio_generation_jobs",
        sa.Column("preferred_voice_id", sa.String(length=255), nullable=True),
    )
    op.create_index(
        "ix_audio_generation_jobs_status_created_at",
        "audio_generation_jobs",
        ["status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_audio_generation_jobs_status_created_at",
        table_name="audio_generation_jobs",
    )
    op.drop_column("audio_generation_jobs", "preferred_voice_id")
