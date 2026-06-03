"""initial schema

Revision ID: 20260416_000001
Revises:
Create Date: 2026-04-16 00:00:01
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.models.sqltypes import GeometryPoint4326

revision = "20260416_000001"
down_revision = None
branch_labels = None
depends_on = None


content_type_enum = postgresql.ENUM(
    "prose", "poetry", "lyrics", name="content_type", create_type=False
)
translation_status_enum = postgresql.ENUM(
    "pending", "approved", "rejected", name="translation_status", create_type=False
)
language_enum = postgresql.ENUM(
    "pt", "en", "es", "fr", "de", "zh", name="language", create_type=False
)
audio_job_status_enum = postgresql.ENUM(
    "pending", "running", "completed", "failed", name="audio_job_status", create_type=False
)
audio_job_item_status_enum = postgresql.ENUM(
    "pending",
    "running",
    "completed",
    "failed",
    name="audio_job_item_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    content_type_enum.create(bind, checkfirst=True)
    translation_status_enum.create(bind, checkfirst=True)
    language_enum.create(bind, checkfirst=True)
    audio_job_status_enum.create(bind, checkfirst=True)
    audio_job_item_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "admin_users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "voices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("elevenlabs_id", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("preview_url", sa.String(length=2048), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("elevenlabs_id"),
    )

    op.create_table(
        "authors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("bio_pt", sa.Text(), nullable=True),
        sa.Column("birth_year", sa.Integer(), nullable=True),
        sa.Column("death_year", sa.Integer(), nullable=True),
        sa.Column("photo_url", sa.String(length=2048), nullable=True),
        sa.Column("elevenlabs_voice_id", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["elevenlabs_voice_id"],
            ["voices.elevenlabs_id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "points",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title_pt", sa.String(length=255), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("neighborhood", sa.String(length=255), nullable=True),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("geom", GeometryPoint4326(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "texts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("point_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("content_pt", sa.Text(), nullable=False),
        sa.Column("source_work", sa.String(length=255), nullable=True),
        sa.Column("source_year", sa.Integer(), nullable=True),
        sa.Column("content_type", content_type_enum, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["author_id"], ["authors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["point_id"], ["points.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_texts_author_id", "texts", ["author_id"])
    op.create_index("ix_texts_point_id", "texts", ["point_id"])

    op.create_table(
        "translations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("text_id", sa.Uuid(), nullable=False),
        sa.Column("lang", language_enum, nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", translation_status_enum, nullable=False, server_default="pending"),
        sa.Column("auto_translated", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("reviewed_by", sa.String(length=320), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["text_id"], ["texts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("text_id", "lang", name="uq_translations_text_lang"),
    )

    op.create_table(
        "audio_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("text_id", sa.Uuid(), nullable=False),
        sa.Column("lang", language_enum, nullable=False),
        sa.Column("r2_key", sa.String(length=1024), nullable=True),
        sa.Column("public_url", sa.String(length=2048), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("voice_id", sa.String(length=255), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("manually_uploaded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["text_id"], ["texts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("text_id", "lang", name="uq_audio_files_text_lang"),
    )

    op.create_table(
        "routes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title_pt", sa.String(length=255), nullable=False),
        sa.Column("description_pt", sa.Text(), nullable=True),
        sa.Column("cover_image_url", sa.String(length=2048), nullable=True),
        sa.Column("difficulty", sa.String(length=50), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("estimated_distance_m", sa.Float(), nullable=True),
        sa.Column("estimated_duration_s", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "route_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("route_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("point_id", sa.Uuid(), nullable=True),
        sa.Column("waypoint_lat", sa.Float(), nullable=True),
        sa.Column("waypoint_lng", sa.Float(), nullable=True),
        sa.Column("transition_text_pt", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "(point_id IS NOT NULL) OR (waypoint_lat IS NOT NULL AND waypoint_lng IS NOT NULL)",
            name="ck_route_items_point_or_waypoint",
        ),
        sa.ForeignKeyConstraint(["point_id"], ["points.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id", "position", name="uq_route_items_route_position"),
    )

    op.create_table(
        "audio_generation_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("status", audio_job_status_enum, nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.String(length=320), nullable=True),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("succeeded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "audio_generation_job_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("text_id", sa.Uuid(), nullable=False),
        sa.Column("lang", language_enum, nullable=False),
        sa.Column("status", audio_job_item_status_enum, nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["job_id"], ["audio_generation_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["text_id"], ["texts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "text_id", "lang", name="uq_audio_job_item_job_text_lang"),
    )


def downgrade() -> None:
    op.drop_table("audio_generation_job_items")
    op.drop_table("audio_generation_jobs")
    op.drop_table("route_items")
    op.drop_table("routes")
    op.drop_table("audio_files")
    op.drop_table("translations")
    op.drop_index("ix_texts_author_id", table_name="texts")
    op.drop_index("ix_texts_point_id", table_name="texts")
    op.drop_table("texts")
    op.drop_table("points")
    op.drop_table("authors")
    op.drop_table("voices")
    op.drop_table("admin_users")

    bind = op.get_bind()
    audio_job_item_status_enum.drop(bind, checkfirst=True)
    audio_job_status_enum.drop(bind, checkfirst=True)
    language_enum.drop(bind, checkfirst=True)
    translation_status_enum.drop(bind, checkfirst=True)
    content_type_enum.drop(bind, checkfirst=True)
