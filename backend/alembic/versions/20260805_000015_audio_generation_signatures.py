"""add audio generation signatures

Revision ID: 20260805_000015
Revises: 20260805_000014
Create Date: 2026-08-05 00:00:15
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_000015"
down_revision = "20260805_000014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audio_files", sa.Column("recipe_hash", sa.String(length=64), nullable=True))
    op.add_column("audio_files", sa.Column("content_hash", sa.String(length=64), nullable=True))
    op.add_column("audio_files", sa.Column("generation_spec", sa.JSON(), nullable=True))
    op.create_index("ix_audio_files_recipe_hash", "audio_files", ["recipe_hash"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audio_files_recipe_hash", table_name="audio_files")
    op.drop_column("audio_files", "generation_spec")
    op.drop_column("audio_files", "content_hash")
    op.drop_column("audio_files", "recipe_hash")
