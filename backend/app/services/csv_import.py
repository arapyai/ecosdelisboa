import csv
import io
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Author, Point, Text
from app.models.enums import ContentType
from app.services.geocoding import GeocodingResult, geocode_address

DEFAULT_CITY = "Lisboa"
DEFAULT_COUNTRY = "Portugal"

REQUIRED_COLUMNS = {
    "point_name",
    "address",
    "author_name",
    "content_pt",
    "content_type",
}


@dataclass
class ImportPreviewRow:
    row_number: int
    point_name: str
    address: str
    author_name: str
    action: str
    errors: list[str]


@dataclass
class ImportRow:
    row_number: int
    point_name: str
    address: str
    neighborhood: str | None
    city: str
    country: str
    lat: float | None
    lng: float | None
    author_name: str
    content_pt: str
    content_type: ContentType | None
    source_work: str | None
    source_year: int | None
    errors: list[str]


Geocoder = Callable[..., GeocodingResult]


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


def parse_optional_int(raw: str, field: str, errors: list[str]) -> int | None:
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        errors.append(f"{field} must be a valid integer")
        return None


def parse_optional_float(raw: str, field: str, errors: list[str]) -> float | None:
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        errors.append(f"{field} must be a valid number")
        return None


def find_point(db: Session, point_name: str, address: str) -> Point | None:
    return db.scalar(select(Point).where(Point.title_pt == point_name, Point.address == address))


def find_text(
    db: Session,
    *,
    point: Point,
    author: Author,
    source_work: str | None,
    source_year: int | None,
    content_pt: str,
) -> Text | None:
    return db.scalar(
        select(Text).where(
            Text.point_id == point.id,
            Text.author_id == author.id,
            Text.source_work == source_work,
            Text.source_year == source_year,
            Text.content_pt == content_pt,
        )
    )


def resolve_coordinates(
    *,
    address: str,
    neighborhood: str | None,
    city: str,
    country: str,
    lat_override: str,
    lng_override: str,
    errors: list[str],
    geocoder: Geocoder,
) -> tuple[float | None, float | None]:
    lat = parse_optional_float(lat_override, "lat_override", errors)
    lng = parse_optional_float(lng_override, "lng_override", errors)
    if bool(lat_override) != bool(lng_override):
        errors.append("lat_override and lng_override must be provided together")
        return None, None
    if lat is not None and lng is not None:
        return lat, lng
    if errors:
        return None, None

    try:
        result = geocoder(
            address=address,
            neighborhood=neighborhood,
            city=city,
            country=country,
        )
    except Exception as exc:
        errors.append(f"geocoding failed: {exc}")
        return None, None
    return result.lat, result.lng


def build_import_rows(
    csv_content: str,
    *,
    geocoder: Geocoder = geocode_address,
) -> list[ImportRow]:
    rows = parse_csv_rows(csv_content)
    parsed: list[ImportRow] = []

    for index, row in enumerate(rows, start=2):
        errors: list[str] = []
        point_name = clean(row, "point_name")
        address = clean(row, "address")
        neighborhood = clean(row, "neighborhood") or None
        city = clean(row, "city") or DEFAULT_CITY
        country = clean(row, "country") or DEFAULT_COUNTRY
        author_name = clean(row, "author_name")
        content_pt = clean(row, "content_pt")
        content_type_raw = clean(row, "content_type")
        source_work = clean(row, "source_work") or None
        source_year = parse_optional_int(clean(row, "source_year"), "source_year", errors)

        if not point_name:
            errors.append("point_name is required")
        if not address:
            errors.append("address is required")
        if not author_name:
            errors.append("author_name is required")
        if not content_pt:
            errors.append("content_pt is required")

        content_type = None
        if content_type_raw in {item.value for item in ContentType}:
            content_type = ContentType(content_type_raw)
        else:
            errors.append("content_type must be one of prose, poetry, lyrics")

        lat: float | None = None
        lng: float | None = None
        if not errors:
            lat, lng = resolve_coordinates(
                address=address,
                neighborhood=neighborhood,
                city=city,
                country=country,
                lat_override=clean(row, "lat_override"),
                lng_override=clean(row, "lng_override"),
                errors=errors,
                geocoder=geocoder,
            )

        parsed.append(
            ImportRow(
                row_number=index,
                point_name=point_name,
                address=address,
                neighborhood=neighborhood,
                city=city,
                country=country,
                lat=lat,
                lng=lng,
                author_name=author_name,
                content_pt=content_pt,
                content_type=content_type,
                source_work=source_work,
                source_year=source_year,
                errors=errors,
            )
        )

    return parsed


def preview_import(
    csv_content: str,
    db: Session,
    *,
    geocoder: Geocoder = geocode_address,
) -> list[ImportPreviewRow]:
    preview: list[ImportPreviewRow] = []

    for row in build_import_rows(csv_content, geocoder=geocoder):
        action = "error"
        if not row.errors:
            author = db.scalar(select(Author).where(Author.name == row.author_name))
            point = find_point(db, row.point_name, row.address)
            existing_text = None
            if author is not None and point is not None:
                existing_text = find_text(
                    db,
                    point=point,
                    author=author,
                    source_work=row.source_work,
                    source_year=row.source_year,
                    content_pt=row.content_pt,
                )
            action = "update" if existing_text is not None else "create"

        preview.append(
            ImportPreviewRow(
                row_number=row.row_number,
                point_name=row.point_name,
                address=row.address,
                author_name=row.author_name,
                action=action,
                errors=row.errors,
            )
        )

    return preview


def apply_import(
    csv_content: str,
    db: Session,
    *,
    geocoder: Geocoder = geocode_address,
) -> dict[str, object]:
    rows = build_import_rows(csv_content, geocoder=geocoder)
    created = 0
    updated = 0

    for row in rows:
        if row.errors:
            continue
        if row.content_type is None or row.lat is None or row.lng is None:
            continue

        author = db.scalar(select(Author).where(Author.name == row.author_name))
        if author is None:
            author = Author(name=row.author_name)
            db.add(author)
            db.flush()

        point = find_point(db, row.point_name, row.address)
        if point is None:
            point = Point(
                title_pt=row.point_name,
                address=row.address,
                neighborhood=row.neighborhood,
                lat=row.lat,
                lng=row.lng,
            )
            db.add(point)
            db.flush()
        else:
            point.neighborhood = row.neighborhood or point.neighborhood
            point.lat = row.lat
            point.lng = row.lng

        existing_text = find_text(
            db,
            point=point,
            author=author,
            source_work=row.source_work,
            source_year=row.source_year,
            content_pt=row.content_pt,
        )
        if existing_text is None:
            text = Text(
                point_id=point.id,
                author_id=author.id,
                content_pt=row.content_pt,
                source_work=row.source_work,
                source_year=row.source_year,
                content_type=row.content_type,
            )
            db.add(text)
            created += 1
        else:
            existing_text.content_type = row.content_type
            updated += 1

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "errors": [
            {
                "row_number": row.row_number,
                "point_name": row.point_name,
                "address": row.address,
                "author_name": row.author_name,
                "errors": row.errors,
            }
            for row in rows
            if row.errors
        ],
    }
