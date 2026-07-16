"""add translations for authors and routes

Revision ID: 20260716_000007
Revises: 20260716_000006
Create Date: 2026-07-16 00:00:07
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260716_000007"
down_revision = "20260716_000006"
branch_labels = None
depends_on = None

translation_status_enum = postgresql.ENUM(
    "pending",
    "approved",
    "rejected",
    name="translation_status",
    create_type=False,
)


def _editorial_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lang", sa.String(length=16), nullable=False),
        sa.Column(
            "status",
            translation_status_enum,
            nullable=False,
            server_default="pending",
        ),
        sa.Column("auto_translated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("origin", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("reviewed_by", sa.String(length=320), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "author_translations",
        *_editorial_columns(),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("bio", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["authors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lang"], ["languages.code"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("author_id", "lang", name="uq_author_translations_author_lang"),
    )
    op.create_table(
        "route_translations",
        *_editorial_columns(),
        sa.Column("route_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lang"], ["languages.code"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id", "lang", name="uq_route_translations_route_lang"),
    )


def downgrade() -> None:
    op.drop_table("route_translations")
    op.drop_table("author_translations")
