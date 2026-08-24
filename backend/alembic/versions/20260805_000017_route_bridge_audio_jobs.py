"""support route bridge audio jobs

Revision ID: 20260805_000017
Revises: 20260805_000016
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision = "20260805_000017"
down_revision = "20260805_000016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("route_segment_audio_files") as batch:
        batch.add_column(sa.Column("r2_key", sa.String(1024), nullable=True))
        batch.add_column(sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table("audio_generation_job_items") as batch:
        batch.alter_column("text_id", existing_type=sa.Uuid(), nullable=True)
        batch.add_column(sa.Column("route_segment_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_audio_generation_job_items_route_segment_id_route_items",
            "route_items",
            ["route_segment_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_unique_constraint(
            "uq_audio_job_item_job_route_segment_lang",
            ["job_id", "route_segment_id", "lang"],
        )
        batch.create_check_constraint(
            "ck_audio_generation_job_items_content_target",
            "(text_id IS NOT NULL AND route_segment_id IS NULL) OR "
            "(text_id IS NULL AND route_segment_id IS NOT NULL)",
        )


def downgrade() -> None:
    op.execute("DELETE FROM audio_generation_job_items WHERE route_segment_id IS NOT NULL")
    with op.batch_alter_table("audio_generation_job_items") as batch:
        batch.drop_constraint("ck_audio_generation_job_items_content_target", type_="check")
        batch.drop_constraint("uq_audio_job_item_job_route_segment_lang", type_="unique")
        batch.drop_constraint(
            "fk_audio_generation_job_items_route_segment_id_route_items",
            type_="foreignkey",
        )
        batch.drop_column("route_segment_id")
        batch.alter_column("text_id", existing_type=sa.Uuid(), nullable=False)

    with op.batch_alter_table("route_segment_audio_files") as batch:
        batch.drop_column("generated_at")
        batch.drop_column("r2_key")
