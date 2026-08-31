"""add permanent point review codes

Revision ID: 20260831_000019
Revises: 20260805_000018
Create Date: 2026-08-31 00:00:19
"""

import sqlalchemy as sa
from alembic import op

revision = "20260831_000019"
down_revision = "20260805_000018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("points", sa.Column("review_code", sa.String(length=16), nullable=True))
    connection = op.get_bind()
    point_ids = connection.execute(
        sa.text("SELECT id FROM points ORDER BY created_at, id")
    ).scalars()
    next_value = 1
    for point_id in point_ids:
        connection.execute(
            sa.text("UPDATE points SET review_code = :code WHERE id = :point_id"),
            {"code": f"P{next_value:04d}", "point_id": point_id},
        )
        next_value += 1

    op.create_unique_constraint("uq_points_review_code", "points", ["review_code"])
    op.create_table(
        "point_review_code_counters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_point_review_code_counters")),
    )
    connection.execute(
        sa.text(
            "INSERT INTO point_review_code_counters (id, next_value) "
            "VALUES (1, :next_value)"
        ),
        {"next_value": next_value},
    )


def downgrade() -> None:
    op.drop_table("point_review_code_counters")
    op.drop_constraint("uq_points_review_code", "points", type_="unique")
    op.drop_column("points", "review_code")
