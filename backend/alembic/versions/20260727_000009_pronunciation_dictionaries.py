"""store active ElevenLabs pronunciation dictionaries

Revision ID: 20260727_000009
Revises: 20260716_000008
Create Date: 2026-07-27 00:00:09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260727_000009"
down_revision = "20260716_000008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pronunciation_dictionaries",
        sa.Column("language_code", sa.String(length=16), nullable=False),
        sa.Column("elevenlabs_id", sa.String(length=255), nullable=False),
        sa.Column("version_id", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("last_published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_published_by", sa.String(length=320), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["language_code"],
            ["languages.code"],
            name=op.f("fk_pronunciation_dictionaries_language_code_languages"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pronunciation_dictionaries")),
        sa.UniqueConstraint(
            "elevenlabs_id",
            name=op.f("uq_pronunciation_dictionaries_elevenlabs_id"),
        ),
        sa.UniqueConstraint(
            "language_code",
            name=op.f("uq_pronunciation_dictionaries_language_code"),
        ),
    )


def downgrade() -> None:
    op.drop_table("pronunciation_dictionaries")
