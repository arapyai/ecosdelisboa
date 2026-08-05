"""persist content generation batches and translation jobs

Revision ID: 20260805_000011
Revises: 20260805_000010
Create Date: 2026-08-05 00:00:11
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260805_000011"
down_revision = "20260805_000010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "content_generation_batches",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column(
            "current_stage",
            sa.String(length=32),
            nullable=False,
            server_default="generating_translations",
        ),
        sa.Column("requested_by", sa.String(length=320), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="texts"),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("audio_generation_jobs", sa.Column("batch_id", sa.Uuid(), nullable=True))
    op.add_column(
        "audio_generation_jobs", sa.Column("batch_stage", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "audio_generation_jobs",
        sa.Column(
            "policy", sa.String(length=32), nullable=False, server_default="replace_automatic"
        ),
    )
    op.add_column(
        "audio_generation_jobs",
        sa.Column("skipped", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_audio_generation_jobs_batch_id", "audio_generation_jobs", ["batch_id"])
    op.create_foreign_key(
        "fk_audio_generation_jobs_batch_id",
        "audio_generation_jobs",
        "content_generation_batches",
        ["batch_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column(
        "audio_generation_job_items",
        sa.Column("was_skipped", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "translation_generation_jobs",
        sa.Column("batch_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.String(length=320), nullable=True),
        sa.Column("policy", sa.String(length=32), nullable=False, server_default="missing_only"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("succeeded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"], ["content_generation_batches.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_translation_generation_jobs_batch_id", "translation_generation_jobs", ["batch_id"]
    )
    op.create_index(
        "ix_translation_generation_jobs_status_created_at",
        "translation_generation_jobs",
        ["status", "created_at"],
    )
    op.create_table(
        "translation_generation_job_items",
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("text_id", sa.Uuid(), nullable=False),
        sa.Column("lang", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("was_skipped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["job_id"], ["translation_generation_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lang"], ["languages.code"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["text_id"], ["texts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "job_id", "text_id", "lang", name="uq_translation_job_item_job_text_lang"
        ),
    )


def downgrade() -> None:
    op.drop_table("translation_generation_job_items")
    op.drop_index(
        "ix_translation_generation_jobs_status_created_at", table_name="translation_generation_jobs"
    )
    op.drop_index(
        "ix_translation_generation_jobs_batch_id", table_name="translation_generation_jobs"
    )
    op.drop_table("translation_generation_jobs")
    op.drop_column("audio_generation_job_items", "was_skipped")
    op.drop_constraint(
        "fk_audio_generation_jobs_batch_id", "audio_generation_jobs", type_="foreignkey"
    )
    op.drop_index("ix_audio_generation_jobs_batch_id", table_name="audio_generation_jobs")
    op.drop_column("audio_generation_jobs", "skipped")
    op.drop_column("audio_generation_jobs", "policy")
    op.drop_column("audio_generation_jobs", "batch_stage")
    op.drop_column("audio_generation_jobs", "batch_id")
    op.drop_table("content_generation_batches")
