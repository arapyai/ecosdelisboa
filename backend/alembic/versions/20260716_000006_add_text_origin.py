"""record the origin of source texts and translations

Revision ID: 20260716_000006
Revises: 20260710_000005
Create Date: 2026-07-16 00:00:06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260716_000006"
down_revision = "20260710_000005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "texts",
        sa.Column("origin", sa.String(length=16), nullable=False, server_default="manual"),
    )
    op.add_column(
        "translations",
        sa.Column("origin", sa.String(length=16), nullable=False, server_default="automatic"),
    )
    op.execute("UPDATE translations SET origin = 'manual' WHERE auto_translated = false")


def downgrade() -> None:
    op.drop_column("translations", "origin")
    op.drop_column("texts", "origin")
