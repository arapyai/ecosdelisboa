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
        "authors",
        "languages",
        "points",
        "route_items",
        "routes",
        "texts",
        "translations",
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


def test_geometry_type_emits_postgis_column_spec() -> None:
    assert GeometryPoint4326().get_col_spec() == "GEOMETRY(POINT,4326)"
