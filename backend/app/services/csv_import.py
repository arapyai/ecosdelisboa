import csv
import io
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Author, Point, Text
from app.models.enums import ContentType

REQUIRED_COLUMNS = {
    "author_name",
    "title",
    "lat",
    "lng",
    "content_pt",
    "content_type",
}


@dataclass
class ImportPreviewRow:
    row_number: int
    author_name: str
    title: str
    action: str
    errors: list[str]


def parse_csv_rows(csv_content: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(csv_content))
    if reader.fieldnames is None:
        raise ValueError("CSV header is required")

    missing = REQUIRED_COLUMNS - set(reader.fieldnames)
    if missing:
        missing_columns = ", ".join(sorted(missing))
        raise ValueError(f"Missing required CSV columns: {missing_columns}")

    return [dict(row) for row in reader]


def preview_import(csv_content: str, db: Session) -> list[ImportPreviewRow]:
    rows = parse_csv_rows(csv_content)
    preview: list[ImportPreviewRow] = []

    for index, row in enumerate(rows, start=2):
        errors: list[str] = []
        author_name = row.get("author_name", "").strip()
        title = row.get("title", "").strip()
        lat_raw = row.get("lat", "").strip()
        lng_raw = row.get("lng", "").strip()
        content_type = row.get("content_type", "").strip()

        if not author_name:
            errors.append("author_name is required")
        if not title:
            errors.append("title is required")

        try:
            float(lat_raw)
            float(lng_raw)
        except ValueError:
            errors.append("lat and lng must be valid numbers")

        if content_type not in {item.value for item in ContentType}:
            errors.append("content_type must be one of prose, poetry, lyrics")

        action = "error"
        if not errors:
            point = db.scalar(select(Point).where(Point.title_pt == title))
            action = "update" if point is not None else "create"

        preview.append(
            ImportPreviewRow(
                row_number=index,
                author_name=author_name,
                title=title,
                action=action,
                errors=errors,
            )
        )

    return preview


def apply_import(csv_content: str, db: Session) -> dict[str, object]:
    preview = preview_import(csv_content, db)
    created = 0
    updated = 0

    for row, preview_row in zip(parse_csv_rows(csv_content), preview, strict=True):
        if preview_row.errors:
            continue

        author = db.scalar(select(Author).where(Author.name == preview_row.author_name))
        if author is None:
            author = Author(name=preview_row.author_name)
            db.add(author)
            db.flush()

        point = db.scalar(select(Point).where(Point.title_pt == preview_row.title))
        if point is None:
            point = Point(
                title_pt=preview_row.title,
                address=(row.get("address") or "").strip() or None,
                neighborhood=(row.get("neighborhood") or "").strip() or None,
                lat=float(row["lat"]),
                lng=float(row["lng"]),
            )
            db.add(point)
            db.flush()
            text = Text(
                point_id=point.id,
                author_id=author.id,
                content_pt=(row.get("content_pt") or "").strip(),
                source_work=(row.get("source_work") or "").strip() or None,
                source_year=(
                    int(row["source_year"]) if (row.get("source_year") or "").strip() else None
                ),
                content_type=ContentType((row.get("content_type") or "").strip()),
            )
            db.add(text)
            created += 1
            continue

        point.address = (row.get("address") or "").strip() or point.address
        point.neighborhood = (row.get("neighborhood") or "").strip() or point.neighborhood
        point.lat = float(row["lat"])
        point.lng = float(row["lng"])
        existing_text = db.scalar(select(Text).where(Text.point_id == point.id, Text.author_id == author.id))
        if existing_text is None:
            existing_text = Text(
                point_id=point.id,
                author_id=author.id,
                content_pt=(row.get("content_pt") or "").strip(),
                source_work=(row.get("source_work") or "").strip() or None,
                source_year=(
                    int(row["source_year"]) if (row.get("source_year") or "").strip() else None
                ),
                content_type=ContentType((row.get("content_type") or "").strip()),
            )
            db.add(existing_text)
        else:
            existing_text.content_pt = (row.get("content_pt") or "").strip()
            existing_text.source_work = (row.get("source_work") or "").strip() or None
            existing_text.source_year = (
                int(row["source_year"]) if (row.get("source_year") or "").strip() else None
            )
            existing_text.content_type = ContentType((row.get("content_type") or "").strip())
        updated += 1

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "errors": [preview_row.__dict__ for preview_row in preview if preview_row.errors],
    }
