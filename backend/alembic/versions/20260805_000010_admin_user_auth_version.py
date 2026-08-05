"""version admin user authentication

Revision ID: 20260805_000010
Revises: 20260727_000009
Create Date: 2026-08-05 00:00:10
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260805_000010"
down_revision = "20260727_000009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column("auth_version", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("admin_users", "auth_version")
