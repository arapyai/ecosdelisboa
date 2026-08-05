from pathlib import Path
from runpy import run_path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, DateTime, MetaData, String, Table, create_engine, inspect


def test_narrative_route_tables_generate_created_at(tmp_path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'migrations.db'}"
    engine = create_engine(database_url)
    metadata = MetaData()
    table_names = (
        "route_segment_translations",
        "route_segment_audio_files",
        "route_legs",
    )
    for table_name in table_names:
        Table(
            table_name,
            metadata,
            Column("id", String(36), primary_key=True),
            Column("created_at", DateTime(timezone=True), nullable=False),
        )
    metadata.create_all(engine)

    migration = run_path(Path("alembic/versions/20260805_000018_route_segment_timestamps.py"))
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        migration["upgrade"].__globals__["op"] = operations
        migration["upgrade"]()

    inspector = inspect(engine)
    for table_name in table_names:
        created_at = next(
            column for column in inspector.get_columns(table_name) if column["name"] == "created_at"
        )
        assert created_at["default"] is not None
