import csv
import io
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Author, Point, Text
from app.models.enums import ContentType
from app.services.geocoding import geocode_address

REQUIRED_COLUMNS = {
    "author_name",
    "point_name",
    "address",
    "neighborhood",
    "city",
    "country",
    "lat_override",
    "lng_override",
    "content_pt",
    "content_type",
    "source_work",
    "source_year",
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


def clean(row: dict[str, str], field: str) -> str:
    return (row.get(field) or "").strip()


def parse_coordinate_pair(
    row: dict[str, str],
    errors: list[str],
) -> tuple[float | None, float | None]:
    lat_raw = clean(row, "lat_override")
    lng_raw = clean(row, "lng_override")

    if not lat_raw and not lng_raw:
        return None, None
    if not lat_raw or not lng_raw:
        errors.append("lat_override and lng_override must be provided together")
        return None, None

    try:
        return float(lat_raw), float(lng_raw)
    except ValueError:
        errors.append("lat_override and lng_override must be valid numbers")
        return None, None


def parse_source_year(row: dict[str, str], errors: list[str]) -> int | None:
    source_year = clean(row, "source_year")
    if not source_year:
        return None

    try:
        return int(source_year)
    except ValueError:
        errors.append("source_year must be a valid integer")
        return None


def resolve_content_type(raw: str) -> ContentType:
    if raw in {item.value for item in ContentType}:
        return ContentType(raw)
    return ContentType.POETRY


def resolve_coordinates(
    row: dict[str, str],
    errors: list[str],
    *,
    geocoder,
) -> tuple[float | None, float | None]:
    lat, lng = parse_coordinate_pair(row, errors)
    if lat is not None and lng is not None:
        return lat, lng
    if errors:
        return None, None

    try:
        result = geocoder(
            address=clean(row, "address"),
            neighborhood=clean(row, "neighborhood") or None,
            city=clean(row, "city") or "Lisboa",
            country=clean(row, "country") or "Portugal",
        )
        return result.lat, result.lng
    except Exception as exc:
        errors.append(f"geocoding failed: {exc}")
        return None, None


def preview_import(
    csv_content: str,
    db: Session,
    *,
    geocoder=geocode_address,
) -> list[ImportPreviewRow]:
    rows = parse_csv_rows(csv_content)
    preview: list[ImportPreviewRow] = []

    for index, row in enumerate(rows, start=2):
        errors: list[str] = []
        author_name = clean(row, "author_name")
        title = clean(row, "point_name")
        content_pt = clean(row, "content_pt")
        content_type = clean(row, "content_type")
        parse_source_year(row, errors)

        if not author_name:
            errors.append("author_name is required")
        if not title:
            errors.append("point_name is required")
        if not content_pt:
            errors.append("content_pt is required")

        content_type = resolve_content_type(content_type).value

        action = "error"
        if title and not errors:
            point = db.scalar(select(Point).where(Point.title_pt == title))
            if point is not None:
                action = "update"
            else:
                lat, lng = resolve_coordinates(row, errors, geocoder=geocoder)
                if lat is not None and lng is not None:
                    action = "create"

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


def apply_import(
    csv_content: str,
    db: Session,
    *,
    geocoder=geocode_address,
) -> dict[str, object]:
    preview = preview_import(csv_content, db, geocoder=geocoder)
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
        source_year = parse_source_year(row, [])
        if point is None:
            errors: list[str] = []
            lat, lng = resolve_coordinates(row, errors, geocoder=geocoder)
            if lat is None or lng is None:
                continue
            point = Point(
                title_pt=preview_row.title,
                address=clean(row, "address") or None,
                neighborhood=clean(row, "neighborhood") or None,
                lat=lat,
                lng=lng,
            )
            db.add(point)
            db.flush()
            text = Text(
                point_id=point.id,
                author_id=author.id,
                content_pt=clean(row, "content_pt"),
                source_work=clean(row, "source_work") or None,
                source_year=source_year,
                content_type=resolve_content_type(clean(row, "content_type")),
            )
            db.add(text)
            created += 1
            continue

        point.address = clean(row, "address") or point.address
        point.neighborhood = clean(row, "neighborhood") or point.neighborhood
        olat, olng = parse_coordinate_pair(row, [])
        if olat is not None and olng is not None:
            point.lat = olat
            point.lng = olng
        existing_text = db.scalar(
            select(Text).where(Text.point_id == point.id, Text.author_id == author.id)
        )
        if existing_text is None:
            existing_text = Text(
                point_id=point.id,
                author_id=author.id,
                content_pt=clean(row, "content_pt"),
                source_work=clean(row, "source_work") or None,
                source_year=source_year,
                content_type=resolve_content_type(clean(row, "content_type")),
            )
            db.add(existing_text)
        else:
            existing_text.content_pt = clean(row, "content_pt")
            existing_text.source_work = clean(row, "source_work") or None
            existing_text.source_year = source_year
            existing_text.content_type = resolve_content_type(clean(row, "content_type"))
        updated += 1

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "errors": [preview_row.__dict__ for preview_row in preview if preview_row.errors],
    }
