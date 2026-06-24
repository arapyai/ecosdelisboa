"""add phonetic_content to texts and translations

Revision ID: 20260624_000002
Revises: 20260416_000001
Create Date: 2026-06-24 00:00:02
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260624_000002"
down_revision = "20260416_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("texts", sa.Column("phonetic_content", sa.Text(), nullable=True))
    op.add_column(
        "translations", sa.Column("phonetic_content", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("translations", "phonetic_content")
    op.drop_column("texts", "phonetic_content")
