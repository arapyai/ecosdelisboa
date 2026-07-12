"""replace fixed language enum with dynamic language configuration

Revision ID: 20260710_000005
Revises: 20260701_000004
Create Date: 2026-07-10 00:00:05
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260710_000005"
down_revision = "20260701_000004"
branch_labels = None
depends_on = None

LEGACY_LANGUAGES = (
    {
        "code": "pt",
        "locale": "pt-PT",
        "country_code": "PT",
        "name": "Portuguese",
        "is_source": True,
    },
    {"code": "en", "locale": "en-US", "country_code": "US", "name": "English", "is_source": False},
    {"code": "es", "locale": "es-ES", "country_code": "ES", "name": "Spanish", "is_source": False},
    {"code": "fr", "locale": "fr-FR", "country_code": "FR", "name": "French", "is_source": False},
    {"code": "de", "locale": "de-DE", "country_code": "DE", "name": "German", "is_source": False},
    {"code": "zh", "locale": "zh-CN", "country_code": "CN", "name": "Chinese", "is_source": False},
)

language_enum = postgresql.ENUM(
    "pt", "en", "es", "fr", "de", "zh", name="language", create_type=False
)


def _alter_language_column_to_string(table_name: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            table_name,
            "lang",
            existing_type=language_enum,
            type_=sa.String(length=16),
            existing_nullable=False,
            postgresql_using="lang::text",
        )
    else:
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.alter_column(
                "lang",
                existing_type=language_enum,
                type_=sa.String(length=16),
                existing_nullable=False,
            )


def upgrade() -> None:
    op.create_table(
        "languages",
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("locale", sa.String(length=35), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_source", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("code"),
        sa.UniqueConstraint("locale"),
    )
    op.create_index(
        "uq_languages_single_source",
        "languages",
        ["is_source"],
        unique=True,
        postgresql_where=sa.text("is_source"),
        sqlite_where=sa.text("is_source = 1"),
    )
    languages_table = sa.table(
        "languages",
        sa.column("code", sa.String()),
        sa.column("locale", sa.String()),
        sa.column("country_code", sa.String()),
        sa.column("name", sa.String()),
        sa.column("is_source", sa.Boolean()),
    )
    op.bulk_insert(languages_table, list(LEGACY_LANGUAGES))

    op.add_column("voices", sa.Column("gender", sa.String(length=32), nullable=True))
    op.create_table(
        "voice_languages",
        sa.Column("voice_id", sa.Uuid(), nullable=False),
        sa.Column("language_code", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["language_code"], ["languages.code"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["voice_id"], ["voices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("voice_id", "language_code"),
    )
    op.execute(
        "INSERT INTO voice_languages (voice_id, language_code) "
        "SELECT id, CAST(lang AS VARCHAR) FROM voices WHERE lang IS NOT NULL"
    )
    op.drop_column("voices", "lang")

    for table_name in ("translations", "audio_files", "audio_generation_job_items"):
        _alter_language_column_to_string(table_name)
        op.create_foreign_key(
            f"fk_{table_name}_lang_languages",
            table_name,
            "languages",
            ["lang"],
            ["code"],
            ondelete="RESTRICT",
        )

    if op.get_bind().dialect.name == "postgresql":
        language_enum.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        language_enum.create(bind, checkfirst=True)

    op.add_column("voices", sa.Column("lang", language_enum, nullable=True))
    if bind.dialect.name == "postgresql":
        op.execute(
            "UPDATE voices SET lang = selected.language_code::language "
            "FROM (SELECT voice_id, MIN(language_code) AS language_code "
            "FROM voice_languages WHERE language_code IN ('pt','en','es','fr','de','zh') "
            "GROUP BY voice_id) AS selected WHERE voices.id = selected.voice_id"
        )

    for table_name in ("translations", "audio_files", "audio_generation_job_items"):
        op.drop_constraint(f"fk_{table_name}_lang_languages", table_name, type_="foreignkey")
        if bind.dialect.name == "postgresql":
            op.alter_column(
                table_name,
                "lang",
                existing_type=sa.String(length=16),
                type_=language_enum,
                existing_nullable=False,
                postgresql_using=(
                    "CASE WHEN lang IN ('pt','en','es','fr','de','zh') "
                    "THEN lang::language ELSE 'pt'::language END"
                ),
            )
        else:
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.alter_column(
                    "lang",
                    existing_type=sa.String(length=16),
                    type_=language_enum,
                    existing_nullable=False,
                )

    op.drop_table("voice_languages")
    op.drop_column("voices", "gender")
    op.drop_index("uq_languages_single_source", table_name="languages")
    op.drop_table("languages")
