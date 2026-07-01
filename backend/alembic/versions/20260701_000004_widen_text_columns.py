"""widen text columns from varchar 255 to unlimited text

Revision ID: 20260701_000004
Revises: 20260624_000003
Create Date: 2026-07-01 00:00:04
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260701_000004"
down_revision = "20260624_000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "authors",
        "name",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "points",
        "title_pt",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "points",
        "address",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "points",
        "neighborhood",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "texts",
        "source_work",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "texts",
        "source_work",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
    op.alter_column(
        "points",
        "neighborhood",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
    op.alter_column(
        "points",
        "address",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
    op.alter_column(
        "points",
        "title_pt",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
    op.alter_column(
        "authors",
        "name",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
