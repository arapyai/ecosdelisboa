"""add route segment timestamp defaults

Revision ID: 20260805_000018
Revises: 20260805_000017
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision = "20260805_000018"
down_revision = "20260805_000017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "route_segment_translations",
    "route_segment_audio_files",
    "route_legs",
)


def upgrade() -> None:
    for table_name in TABLES:
        with op.batch_alter_table(table_name) as batch:
            batch.alter_column(
                "created_at",
                existing_type=sa.DateTime(timezone=True),
                existing_nullable=False,
                server_default=sa.func.now(),
            )


def downgrade() -> None:
    for table_name in TABLES:
        with op.batch_alter_table(table_name) as batch:
            batch.alter_column(
                "created_at",
                existing_type=sa.DateTime(timezone=True),
                existing_nullable=False,
                server_default=None,
            )
