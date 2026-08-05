"""model narrative route segments

Revision ID: 20260805_000016
Revises: 20260805_000015
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision = "20260805_000016"
down_revision = "20260805_000015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("routes") as batch:
        batch.add_column(sa.Column("slug", sa.String(255), nullable=True))
        batch.add_column(
            sa.Column("routing_status", sa.String(32), nullable=False, server_default="pending")
        )
        batch.add_column(sa.Column("routing_hash", sa.String(64), nullable=True))
        batch.add_column(sa.Column("routing_error", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("migration_status", sa.String(32), nullable=False, server_default="ready")
        )
        batch.add_column(sa.Column("routed_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_unique_constraint("uq_routes_slug", ["slug"])

    with op.batch_alter_table("route_items") as batch:
        batch.drop_constraint("ck_route_items_point_or_waypoint", type_="check")
        batch.add_column(sa.Column("kind", sa.String(16), nullable=False, server_default="legacy"))
        batch.add_column(sa.Column("text_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("bridge_content_pt", sa.Text(), nullable=True))
        batch.create_foreign_key(
            "fk_route_items_text_id",
            "texts",
            ["text_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_index("ix_route_items_text_id", ["text_id"])

    op.execute(
        """
        UPDATE route_items
        SET text_id = (
            SELECT texts.id FROM texts WHERE texts.point_id = route_items.point_id LIMIT 1
        ), kind = 'text'
        WHERE point_id IS NOT NULL
          AND (SELECT COUNT(*) FROM texts WHERE texts.point_id = route_items.point_id) = 1
        """
    )
    op.execute(
        """
        UPDATE routes SET migration_status = 'needs_review', is_published = false
        WHERE EXISTS (
            SELECT 1 FROM route_items
            WHERE route_items.route_id = routes.id AND route_items.kind = 'legacy'
        )
        """
    )

    with op.batch_alter_table("route_items") as batch:
        batch.create_check_constraint(
            "ck_route_items_segment_payload",
            "(kind = 'text' AND text_id IS NOT NULL AND bridge_content_pt IS NULL) OR "
            "(kind = 'bridge' AND text_id IS NULL AND bridge_content_pt IS NOT NULL) OR "
            "(kind = 'legacy' AND ((point_id IS NOT NULL) OR "
            "(waypoint_lat IS NOT NULL AND waypoint_lng IS NOT NULL)))",
        )

    op.create_table(
        "route_segment_translations",
        sa.Column("segment_id", sa.Uuid(), nullable=False),
        sa.Column("lang", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", sa.String(320), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["segment_id"], ["route_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lang"], ["languages.code"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "segment_id", "lang", name="uq_route_segment_translations_segment_lang"
        ),
    )
    op.create_table(
        "route_segment_audio_files",
        sa.Column("segment_id", sa.Uuid(), nullable=False),
        sa.Column("lang", sa.String(16), nullable=False),
        sa.Column("public_url", sa.String(2048), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("voice_id", sa.String(255), nullable=True),
        sa.Column("manually_uploaded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["segment_id"], ["route_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lang"], ["languages.code"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("segment_id", "lang", name="uq_route_segment_audio_segment_lang"),
    )
    op.create_table(
        "route_legs",
        sa.Column("route_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("from_segment_id", sa.Uuid(), nullable=False),
        sa.Column("to_segment_id", sa.Uuid(), nullable=False),
        sa.Column("geometry", sa.JSON(), nullable=False),
        sa.Column("waypoints", sa.JSON(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["from_segment_id"], ["route_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_segment_id"], ["route_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id", "position", name="uq_route_legs_route_position"),
    )


def downgrade() -> None:
    op.drop_table("route_legs")
    op.drop_table("route_segment_audio_files")
    op.drop_table("route_segment_translations")
    with op.batch_alter_table("route_items") as batch:
        batch.drop_constraint("ck_route_items_segment_payload", type_="check")
        batch.drop_index("ix_route_items_text_id")
        batch.drop_constraint("fk_route_items_text_id", type_="foreignkey")
        batch.drop_column("bridge_content_pt")
        batch.drop_column("text_id")
        batch.drop_column("kind")
        batch.create_check_constraint(
            "ck_route_items_point_or_waypoint",
            "(point_id IS NOT NULL) OR (waypoint_lat IS NOT NULL AND waypoint_lng IS NOT NULL)",
        )
    with op.batch_alter_table("routes") as batch:
        batch.drop_constraint("uq_routes_slug", type_="unique")
        batch.drop_column("routed_at")
        batch.drop_column("migration_status")
        batch.drop_column("routing_error")
        batch.drop_column("routing_hash")
        batch.drop_column("routing_status")
        batch.drop_column("slug")
