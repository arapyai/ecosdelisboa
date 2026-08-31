from sqlalchemy import CheckConstraint, UniqueConstraint

from app.models.base import Base
from app.models.sqltypes import GeometryPoint4326


def test_expected_tables_exist() -> None:
    table_names = set(Base.metadata.tables)

    assert table_names == {
        "admin_users",
        "audio_files",
        "audio_generation_job_items",
        "audio_generation_jobs",
        "content_generation_batches",
        "author_translations",
        "authors",
        "languages",
        "points",
        "point_review_code_counters",
        "pronunciation_dictionaries",
        "route_items",
        "route_legs",
        "route_segment_audio_files",
        "route_segment_translations",
        "routes",
        "route_translations",
        "texts",
        "translations",
        "translation_generation_job_items",
        "translation_generation_jobs",
        "voices",
        "voice_languages",
    }


def test_translation_uniqueness() -> None:
    translations = Base.metadata.tables["translations"]
    unique_constraints = [c for c in translations.constraints if isinstance(c, UniqueConstraint)]
    assert any(
        {"text_id", "lang"} == {column.name for column in constraint.columns}
        for constraint in unique_constraints
    )


def test_entity_translation_uniqueness() -> None:
    expected_constraints = {
        "author_translations": {"author_id", "lang"},
        "route_translations": {"route_id", "lang"},
    }

    for table_name, expected_columns in expected_constraints.items():
        table = Base.metadata.tables[table_name]
        unique_constraints = [
            constraint
            for constraint in table.constraints
            if isinstance(constraint, UniqueConstraint)
        ]
        assert any(
            expected_columns == {column.name for column in constraint.columns}
            for constraint in unique_constraints
        )


def test_voice_languages_has_composite_primary_key() -> None:
    association = Base.metadata.tables["voice_languages"]
    assert {column.name for column in association.primary_key.columns} == {
        "voice_id",
        "language_code",
    }


def test_route_items_allow_point_or_free_waypoint() -> None:
    route_items = Base.metadata.tables["route_items"]
    check_constraints = [c for c in route_items.constraints if isinstance(c, CheckConstraint)]

    assert any(
        "point_id IS NOT NULL" in str(constraint.sqltext) for constraint in check_constraints
    )


def test_narrative_route_tables_have_expected_uniqueness() -> None:
    expected = {
        "route_segment_translations": {"segment_id", "lang"},
        "route_segment_audio_files": {"segment_id", "lang"},
        "route_legs": {"route_id", "position"},
    }
    for table_name, columns in expected.items():
        constraints = [
            item
            for item in Base.metadata.tables[table_name].constraints
            if isinstance(item, UniqueConstraint)
        ]
        assert any({column.name for column in item.columns} == columns for item in constraints)


def test_route_items_require_payload_matching_the_segment_kind() -> None:
    constraints = [
        item
        for item in Base.metadata.tables["route_items"].constraints
        if isinstance(item, CheckConstraint)
    ]
    segment_constraint = next(
        item for item in constraints if item.name == "ck_route_items_segment_payload"
    )
    sql = str(segment_constraint.sqltext)
    assert "kind = 'text' AND text_id IS NOT NULL" in sql
    assert "kind = 'bridge' AND text_id IS NULL" in sql


def test_geometry_type_emits_postgis_column_spec() -> None:
    assert GeometryPoint4326().get_col_spec() == "GEOMETRY(POINT,4326)"
