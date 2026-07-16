import csv
import io
import math
import re
import unicodedata
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Author, Language, Point, Text, Translation
from app.models.enums import ContentType, TextOrigin, TranslationStatus
from app.services.geocoding import geocode_address

TEMPLATE_COLUMNS_BEFORE_TRANSLATIONS = (
    "point_name",
    "address",
    "neighborhood",
    "city",
    "country",
    "lat_override",
    "lng_override",
    "author_name",
    "author_bio_pt",
    "birth_date",
    "death_date",
    "content_pt",
)
TEMPLATE_COLUMNS_AFTER_TRANSLATIONS = (
    "content_type",
    "source_work",
    "source_year",
)
REQUIRED_COLUMNS = {"author_name", "point_name", "content_pt"}
POINT_MATCH_DISTANCE_M = 20.0


@dataclass
class ImportPreviewRow:
    row_number: int
    author_name: str
    title: str
    action: str
    author_action: str
    point_action: str
    text_action: str
    translation_actions: dict[str, str]
    geocoded: bool
    lat: float | None
    lng: float | None
    errors: list[str]


@dataclass
class PointCandidate:
    key: str
    point_id: UUID | None
    title: str
    address: str
    lat: float
    lng: float


@dataclass
class ImportPlanRow:
    source: dict[str, str]
    preview: ImportPreviewRow
    author_key: str
    author_id: UUID | None
    point_key: str
    point_id: UUID | None
    text_key: str
    text_id: UUID | None
    translations: dict[str, tuple[UUID | None, str]]


def build_template_csv(language_codes: list[str] | tuple[str, ...] = ("en",)) -> str:
    translation_columns = tuple(f"content_{code}" for code in language_codes if code != "pt")
    fieldnames = (
        *TEMPLATE_COLUMNS_BEFORE_TRANSLATIONS,
        *translation_columns,
        *TEMPLATE_COLUMNS_AFTER_TRANSLATIONS,
    )
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerow(
        {
            "point_name": "Chiado",
            "address": "Largo do Chiado",
            "neighborhood": "Chiado",
            "city": "Lisboa",
            "country": "Portugal",
            "author_name": "Fernando Pessoa",
            "author_bio_pt": "Poeta e escritor portugues.",
            "birth_date": "1888-06-13",
            "death_date": "1935-11-30",
            "content_pt": "Aqui a cidade tem passos de escritorio, cafe e fantasma.",
            **{
                column: "Here the city has footsteps of office, cafe and ghost."
                if column == "content_en"
                else ""
                for column in translation_columns
            },
            "content_type": "prose",
            "source_work": "Fragmento demonstrativo",
            "source_year": "2026",
        }
    )
    return output.getvalue()


def parse_csv_rows(csv_content: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(csv_content.lstrip("\ufeff")))
    if reader.fieldnames is None:
        raise ValueError("CSV header is required")

    fieldnames = {field.strip() for field in reader.fieldnames if field}
    missing = REQUIRED_COLUMNS - fieldnames
    if missing:
        missing_columns = ", ".join(sorted(missing))
        raise ValueError(f"Missing required CSV columns: {missing_columns}")

    return [dict(row) for row in reader]


def clean(row: dict[str, str], field: str) -> str:
    return (row.get(field) or "").strip()


def normalize_lookup(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return " ".join(re.sub(r"[^\w]+", " ", without_marks.casefold()).split())


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
        lat = float(lat_raw)
        lng = float(lng_raw)
    except ValueError:
        errors.append("lat_override and lng_override must be valid numbers")
        return None, None

    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        errors.append("lat_override or lng_override is outside the valid range")
        return None, None
    return lat, lng


def parse_year(value: str, field: str, errors: list[str]) -> int | None:
    if not value:
        return None
    match = re.search(r"\b(\d{4})\b", value)
    if match is None:
        errors.append(f"{field} must contain a valid year")
        return None
    return int(match.group(1))


def parse_source_year(row: dict[str, str], errors: list[str]) -> int | None:
    return parse_year(clean(row, "source_year"), "source_year", errors)


def author_metadata(row: dict[str, str], errors: list[str]) -> dict[str, object]:
    return {
        "bio_pt": clean(row, "author_bio_pt")
        or clean(row, "Microbio curta (camada 2 do app)")
        or None,
        "birth_year": parse_year(
            clean(row, "birth_date") or clean(row, "Data de nascimento"),
            "birth_date",
            errors,
        ),
        "death_year": parse_year(
            clean(row, "death_date") or clean(row, "Data de morte"),
            "death_date",
            errors,
        ),
    }


def resolve_content_type(raw: str, content: str, errors: list[str]) -> ContentType:
    if raw:
        try:
            return ContentType(raw.casefold())
        except ValueError:
            errors.append("content_type must be prose, poetry or lyrics")
            return ContentType.PROSE

    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if len(lines) > 1 and max(map(len, lines), default=0) <= 160:
        return ContentType.POETRY
    return ContentType.PROSE


def distance_meters(lat_a: float, lng_a: float, lat_b: float, lng_b: float) -> float:
    radius = 6_371_000
    phi_a = math.radians(lat_a)
    phi_b = math.radians(lat_b)
    delta_phi = math.radians(lat_b - lat_a)
    delta_lambda = math.radians(lng_b - lng_a)
    haversine = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine))


def find_point_candidate(
    candidates: list[PointCandidate],
    *,
    title: str,
    address: str,
    coordinates: tuple[float, float] | None = None,
) -> PointCandidate | None:
    normalized_title = normalize_lookup(title)
    normalized_address = normalize_lookup(address)

    exact = [
        candidate
        for candidate in candidates
        if normalize_lookup(candidate.title) == normalized_title
        and normalized_address
        and normalize_lookup(candidate.address) == normalized_address
    ]
    if len(exact) == 1:
        return exact[0]

    if normalized_address:
        address_matches = [
            candidate
            for candidate in candidates
            if normalize_lookup(candidate.address) == normalized_address
        ]
        if len(address_matches) == 1:
            return address_matches[0]

    title_matches = [
        candidate
        for candidate in candidates
        if normalize_lookup(candidate.title) == normalized_title
    ]
    if len(title_matches) == 1 and (
        not normalized_address or not normalize_lookup(title_matches[0].address)
    ):
        return title_matches[0]

    if coordinates is not None:
        lat, lng = coordinates
        nearby = [
            candidate
            for candidate in candidates
            if distance_meters(lat, lng, candidate.lat, candidate.lng) <= POINT_MATCH_DISTANCE_M
        ]
        if len(nearby) == 1:
            return nearby[0]

    return None


def resolve_coordinates(
    row: dict[str, str],
    errors: list[str],
    *,
    geocoder,
) -> tuple[float | None, float | None, bool]:
    lat, lng = parse_coordinate_pair(row, errors)
    if lat is not None and lng is not None:
        return lat, lng, False
    if errors:
        return None, None, False

    address = clean(row, "address")
    if not address:
        errors.append("address is required when coordinates are not provided")
        return None, None, False

    try:
        result = geocoder(
            address=address,
            neighborhood=clean(row, "neighborhood") or None,
            city=clean(row, "city") or "Lisboa",
            country=clean(row, "country") or "Portugal",
        )
        return result.lat, result.lng, True
    except Exception as exc:
        errors.append(f"geocoding failed: {exc}")
        return None, None, False


def text_identity(
    *,
    point_key: str,
    author_key: str,
    source_work: str,
    source_year: int | None,
    content: str,
) -> str:
    normalized_work = normalize_lookup(source_work)
    if normalized_work or source_year is not None:
        return f"{point_key}|{author_key}|source:{normalized_work}|{source_year or ''}"
    return f"{point_key}|{author_key}|content:{content.strip()}"


def build_import_plan(
    csv_content: str,
    db: Session,
    *,
    geocoder=geocode_address,
) -> list[ImportPlanRow]:
    rows = parse_csv_rows(csv_content)
    authors = db.scalars(select(Author)).all()
    points = db.scalars(select(Point)).all()
    texts = db.scalars(select(Text)).all()
    translations = db.scalars(select(Translation)).all()
    active_languages = set(
        db.scalars(select(Language.code).where(Language.is_active.is_(True))).all()
    )
    source_language = db.scalar(select(Language.code).where(Language.is_source.is_(True))) or "pt"
    translation_columns = sorted(
        match.group("lang")
        for field in (rows[0].keys() if rows else [])
        if (match := re.fullmatch(r"content_(?P<lang>[a-z]{2,3}(?:-[a-z0-9]{2,8})?)", field))
        and match.group("lang") != source_language
    )

    author_index: dict[str, tuple[UUID | None, Author | None]] = {
        normalize_lookup(author.name): (author.id, author) for author in authors
    }
    point_candidates = [
        PointCandidate(
            key=f"id:{point.id}",
            point_id=point.id,
            title=point.title_pt,
            address=point.address or "",
            lat=point.lat,
            lng=point.lng,
        )
        for point in points
    ]
    point_keys = {point.point_id: point.key for point in point_candidates if point.point_id}
    author_keys = {author.id: normalize_lookup(author.name) for author in authors}
    text_index: dict[str, tuple[UUID | None, Text | None]] = {}
    text_keys_by_id: dict[UUID, str] = {}
    for text in texts:
        key = text_identity(
            point_key=point_keys[text.point_id],
            author_key=author_keys[text.author_id],
            source_work=text.source_work or "",
            source_year=text.source_year,
            content=text.content_pt,
        )
        text_index[key] = (text.id, text)
        text_keys_by_id[text.id] = key
    translation_index = {
        (text_keys_by_id[translation.text_id], translation.lang): translation
        for translation in translations
        if translation.text_id in text_keys_by_id
    }

    plan: list[ImportPlanRow] = []
    for index, row in enumerate(rows, start=2):
        errors: list[str] = []
        author_name = clean(row, "author_name")
        title = clean(row, "point_name")
        address = clean(row, "address")
        content = clean(row, "content_pt")
        source_work = clean(row, "source_work")
        source_year = parse_source_year(row, errors)
        metadata = author_metadata(row, errors)
        content_type = resolve_content_type(clean(row, "content_type"), content, errors)
        translated_contents = {lang: clean(row, f"content_{lang}") for lang in translation_columns}
        for lang, translated_content in translated_contents.items():
            if translated_content and lang not in active_languages:
                errors.append(f"content_{lang} uses an unknown or inactive language")

        if not author_name:
            errors.append("author_name is required")
        if not title:
            errors.append("point_name is required")
        if not content:
            errors.append("content_pt is required")

        author_key = normalize_lookup(author_name)
        author_was_known = author_key in author_index
        author_id, existing_author = author_index.get(author_key, (None, None))
        author_action = "reuse" if author_was_known else "create"
        if existing_author is not None and any(
            value is not None and getattr(existing_author, field) is None
            for field, value in metadata.items()
        ):
            author_action = "update"
        if author_key and author_key not in author_index and not errors:
            author_index[author_key] = (None, None)

        point_action = "error"
        point_key = ""
        point_id: UUID | None = None
        lat: float | None = None
        lng: float | None = None
        geocoded = False
        coordinate_errors: list[str] = []
        override_lat, override_lng = parse_coordinate_pair(row, coordinate_errors)
        if coordinate_errors:
            errors.extend(coordinate_errors)

        candidate = None
        if title and not coordinate_errors and not errors:
            candidate = find_point_candidate(
                point_candidates,
                title=title,
                address=address,
                coordinates=(override_lat, override_lng)
                if override_lat is not None and override_lng is not None
                else None,
            )
        if candidate is None and title and not errors:
            lat, lng, geocoded = resolve_coordinates(row, errors, geocoder=geocoder)
            if lat is not None and lng is not None:
                candidate = find_point_candidate(
                    point_candidates,
                    title=title,
                    address=address,
                    coordinates=(lat, lng),
                )
                if candidate is None:
                    point_key = (
                        f"new:{normalize_lookup(title)}|{normalize_lookup(address)}|"
                        f"{lat:.6f}|{lng:.6f}"
                    )
                    candidate = PointCandidate(
                        key=point_key,
                        point_id=None,
                        title=title,
                        address=address,
                        lat=lat,
                        lng=lng,
                    )
                    point_candidates.append(candidate)
                    point_action = "create"
        if candidate is not None:
            point_key = candidate.key
            point_id = candidate.point_id
            lat = candidate.lat
            lng = candidate.lng
            if point_action != "create":
                point_action = "reuse"

        text_key = ""
        text_id: UUID | None = None
        text_action = "error"
        translation_actions: dict[str, str] = {}
        planned_translations: dict[str, tuple[UUID | None, str]] = {}
        if point_key and author_key and content and not errors:
            text_key = text_identity(
                point_key=point_key,
                author_key=author_key,
                source_work=source_work,
                source_year=source_year,
                content=content,
            )
            text_id, existing_text = text_index.get(text_key, (None, None))
            if existing_text is None and text_key not in text_index:
                text_action = "create"
                text_index[text_key] = (None, None)
            elif existing_text is None:
                text_action = "reuse"
            else:
                expected = (
                    content,
                    source_work or None,
                    source_year,
                    content_type,
                    TextOrigin.IMPORT.value,
                )
                current = (
                    existing_text.content_pt,
                    existing_text.source_work,
                    existing_text.source_year,
                    existing_text.content_type,
                    existing_text.origin,
                )
                text_action = "reuse" if current == expected else "update"

            for lang in translation_columns:
                translated_content = translated_contents[lang]
                if not translated_content:
                    continue
                if lang not in active_languages:
                    translation_actions[lang] = "error"
                    continue
                translation_key = (text_key, lang)
                existing_translation = translation_index.get(translation_key)
                if existing_translation is None and translation_key not in translation_index:
                    translation_action = "create"
                    translation_id = None
                    translation_index[translation_key] = None
                elif existing_translation is None:
                    translation_action = "reuse"
                    translation_id = None
                else:
                    translation_action = (
                        "reuse"
                        if existing_translation.content == translated_content
                        and existing_translation.origin == TextOrigin.IMPORT.value
                        else "update"
                    )
                    translation_id = existing_translation.id
                translation_actions[lang] = translation_action
                planned_translations[lang] = (translation_id, translated_content)

        action = "error"
        if not errors:
            action = (
                "create"
                if "create"
                in {author_action, point_action, text_action, *translation_actions.values()}
                else "update"
            )
        preview = ImportPreviewRow(
            row_number=index,
            author_name=author_name,
            title=title,
            action=action,
            author_action=author_action if not errors else "error",
            point_action=point_action if not errors else "error",
            text_action=text_action if not errors else "error",
            translation_actions=translation_actions,
            geocoded=geocoded,
            lat=lat,
            lng=lng,
            errors=errors,
        )
        plan.append(
            ImportPlanRow(
                source=row,
                preview=preview,
                author_key=author_key,
                author_id=author_id,
                point_key=point_key,
                point_id=point_id,
                text_key=text_key,
                text_id=text_id,
                translations=planned_translations,
            )
        )
    return plan


def preview_import(
    csv_content: str,
    db: Session,
    *,
    geocoder=geocode_address,
) -> list[ImportPreviewRow]:
    return [row.preview for row in build_import_plan(csv_content, db, geocoder=geocoder)]


def _empty_counts() -> dict[str, int]:
    return {"created": 0, "updated": 0, "reused": 0}


def apply_import(
    csv_content: str,
    db: Session,
    *,
    geocoder=geocode_address,
) -> dict[str, object]:
    plan = build_import_plan(csv_content, db, geocoder=geocoder)
    author_objects: dict[str, Author] = {}
    point_objects: dict[str, Point] = {}
    text_objects: dict[str, Text] = {}
    translation_objects: dict[tuple[str, str], Translation] = {}
    authors = _empty_counts()
    points = {**_empty_counts(), "geocoded": 0}
    texts = _empty_counts()
    translations = _empty_counts()
    translations_by_language: dict[str, dict[str, int]] = {}

    for planned in plan:
        preview = planned.preview
        if preview.errors:
            continue

        author = author_objects.get(planned.author_key)
        if author is None:
            author = db.get(Author, planned.author_id) if planned.author_id else None
        metadata_errors: list[str] = []
        metadata = author_metadata(planned.source, metadata_errors)
        if author is None:
            author = Author(name=preview.author_name, **metadata)
            db.add(author)
            db.flush()
            authors["created"] += 1
        else:
            changed = False
            for field, value in metadata.items():
                if value is not None and getattr(author, field) is None:
                    setattr(author, field, value)
                    changed = True
            authors["updated" if changed else "reused"] += 1
        author_objects[planned.author_key] = author

        point = point_objects.get(planned.point_key)
        if point is None:
            point = db.get(Point, planned.point_id) if planned.point_id else None
        if point is None:
            point = Point(
                title_pt=preview.title,
                address=clean(planned.source, "address") or None,
                neighborhood=clean(planned.source, "neighborhood") or None,
                lat=preview.lat,
                lng=preview.lng,
            )
            db.add(point)
            db.flush()
            points["created"] += 1
            if preview.geocoded:
                points["geocoded"] += 1
        else:
            changed = False
            address = clean(planned.source, "address")
            neighborhood = clean(planned.source, "neighborhood")
            if address and not point.address:
                point.address = address
                changed = True
            if neighborhood and not point.neighborhood:
                point.neighborhood = neighborhood
                changed = True
            coordinate_errors: list[str] = []
            override_lat, override_lng = parse_coordinate_pair(planned.source, coordinate_errors)
            if (
                override_lat is not None
                and override_lng is not None
                and (point.lat != override_lat or point.lng != override_lng)
            ):
                point.lat = override_lat
                point.lng = override_lng
                changed = True
            points["updated" if changed else "reused"] += 1
        point_objects[planned.point_key] = point

        text = text_objects.get(planned.text_key)
        if text is None:
            text = db.get(Text, planned.text_id) if planned.text_id else None
        source_year = parse_source_year(planned.source, [])
        content = clean(planned.source, "content_pt")
        content_type = resolve_content_type(clean(planned.source, "content_type"), content, [])
        values = {
            "content_pt": content,
            "source_work": clean(planned.source, "source_work") or None,
            "source_year": source_year,
            "content_type": content_type,
            "origin": TextOrigin.IMPORT.value,
        }
        if text is None:
            text = Text(point_id=point.id, author_id=author.id, **values)
            db.add(text)
            db.flush()
            texts["created"] += 1
        else:
            changed = False
            for field, value in values.items():
                if getattr(text, field) != value:
                    setattr(text, field, value)
                    changed = True
            texts["updated" if changed else "reused"] += 1
        text_objects[planned.text_key] = text

        for lang, (translation_id, translated_content) in planned.translations.items():
            translation_key = (planned.text_key, lang)
            translation = translation_objects.get(translation_key)
            if translation is None:
                translation = db.get(Translation, translation_id) if translation_id else None
            language_counts = translations_by_language.setdefault(lang, _empty_counts())
            if translation is None:
                translation = Translation(
                    text_id=text.id,
                    lang=lang,
                    content=translated_content,
                    status=TranslationStatus.PENDING,
                    auto_translated=False,
                    origin=TextOrigin.IMPORT.value,
                )
                db.add(translation)
                db.flush()
                action = "created"
            elif (
                translation.content != translated_content or translation.origin != TextOrigin.IMPORT
            ):
                translation.content = translated_content
                translation.status = TranslationStatus.PENDING
                translation.auto_translated = False
                translation.origin = TextOrigin.IMPORT.value
                translation.reviewed_by = None
                translation.reviewed_at = None
                action = "updated"
            else:
                action = "reused"
            translations[action] += 1
            language_counts[action] += 1
            translation_objects[translation_key] = translation

    db.commit()
    errors = [row.preview.__dict__ for row in plan if row.preview.errors]
    imported_rows = len(plan) - len(errors)
    created_rows = sum(
        1 for row in plan if not row.preview.errors and row.preview.point_action == "create"
    )
    return {
        "created": created_rows,
        "updated": imported_rows - created_rows,
        "reused": texts["reused"],
        "errors": errors,
        "rows": {"total": len(plan), "imported": imported_rows, "errors": len(errors)},
        "authors": authors,
        "points": points,
        "texts": texts,
        "translations": {**translations, "by_language": translations_by_language},
    }
