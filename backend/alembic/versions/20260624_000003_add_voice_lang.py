"""add lang column to voices

Revision ID: 20260624_000003
Revises: 20260624_000002
Create Date: 2026-06-24 00:00:03
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260624_000003"
down_revision = "20260624_000002"
branch_labels = None
depends_on = None

language_enum = postgresql.ENUM(
    "pt", "en", "es", "fr", "de", "zh", name="language", create_type=False
)


def upgrade() -> None:
    language_enum.create(op.get_bind(), checkfirst=False)
    op.add_column(
        "voices",
        sa.Column(
            "lang",
            language_enum,
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("voices", "lang")
