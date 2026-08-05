from __future__ import annotations

from dataclasses import dataclass

from app.models.entities import Route
from app.models.enums import RouteRoutingStatus, RouteSegmentKind, TranslationStatus
from app.services.routing import route_input_hash


@dataclass(frozen=True)
class ReadinessIssue:
    code: str
    path: str
    message: str
    segment_id: str | None = None

    def serialize(self) -> dict[str, str | None]:
        return {
            "code": self.code,
            "path": self.path,
            "message": self.message,
            "segment_id": self.segment_id,
        }


def route_routing_payload(route: Route) -> list[dict[str, object]]:
    stops = [
        segment
        for segment in route.items
        if segment.kind == RouteSegmentKind.TEXT.value and segment.text is not None
    ]
    legs_by_position = {leg.position: leg for leg in route.legs}
    payload = []
    for position, (start, end) in enumerate(zip(stops, stops[1:], strict=False)):
        leg = legs_by_position.get(position)
        waypoints = leg.waypoints if leg is not None else []
        payload.append(
            {
                "position": position,
                "from_segment_id": str(start.id),
                "to_segment_id": str(end.id),
                "coordinates": [
                    (start.text.point.lng, start.text.point.lat),
                    *[(waypoint["lng"], waypoint["lat"]) for waypoint in waypoints],
                    (end.text.point.lng, end.text.point.lat),
                ],
                "waypoints": waypoints,
            }
        )
    return payload


def evaluate_route_readiness(
    route: Route,
    lang: str,
    source_language: str,
) -> list[ReadinessIssue]:
    issues: list[ReadinessIssue] = []
    if not route.title_pt.strip():
        issues.append(ReadinessIssue("missing_title", "title_pt", "Portuguese title is required"))
    if not (route.description_pt or "").strip():
        issues.append(
            ReadinessIssue(
                "missing_description", "description_pt", "Portuguese description is required"
            )
        )
    if not route.difficulty:
        issues.append(ReadinessIssue("missing_difficulty", "difficulty", "Difficulty is required"))

    if lang != source_language:
        route_translation = next(
            (
                candidate
                for candidate in route.translations
                if candidate.lang == lang and candidate.status == TranslationStatus.APPROVED
            ),
            None,
        )
        if route_translation is None:
            issues.append(
                ReadinessIssue(
                    "missing_route_translation",
                    f"translations.{lang}",
                    f"Approved route metadata is required for {lang}",
                )
            )

    text_segments = [
        segment
        for segment in route.items
        if segment.kind == RouteSegmentKind.TEXT.value and segment.text is not None
    ]
    if len(text_segments) < 2:
        issues.append(
            ReadinessIssue(
                "too_few_texts", "segments", "At least two text segments are required"
            )
        )

    for segment in route.items:
        segment_id = str(segment.id)
        if segment.kind == RouteSegmentKind.LEGACY.value:
            issues.append(
                ReadinessIssue(
                    "legacy_segment",
                    f"segments.{segment.position}",
                    "Legacy segment must be reviewed",
                    segment_id,
                )
            )
            continue
        if segment.kind == RouteSegmentKind.TEXT.value and segment.text is not None:
            text = segment.text
            if not (-90 <= text.point.lat <= 90 and -180 <= text.point.lng <= 180):
                issues.append(
                    ReadinessIssue(
                        "invalid_coordinates",
                        f"segments.{segment.position}.text.point",
                        "Text location coordinates are invalid",
                        segment_id,
                    )
                )
            if lang != source_language and not any(
                translation.lang == lang and translation.status == TranslationStatus.APPROVED
                for translation in text.translations
            ):
                issues.append(
                    ReadinessIssue(
                        "missing_text_translation",
                        f"segments.{segment.position}.text.translations.{lang}",
                        f"Approved text translation is required for {lang}",
                        segment_id,
                    )
                )
            if not any(audio.lang == lang and audio.public_url for audio in text.audio_files):
                issues.append(
                    ReadinessIssue(
                        "missing_text_audio",
                        f"segments.{segment.position}.text.audio.{lang}",
                        f"Text audio is required for {lang}",
                        segment_id,
                    )
                )
        elif segment.kind == RouteSegmentKind.BRIDGE.value:
            if lang != source_language and not any(
                translation.lang == lang and translation.status == TranslationStatus.APPROVED
                for translation in segment.translations
            ):
                issues.append(
                    ReadinessIssue(
                        "missing_bridge_translation",
                        f"segments.{segment.position}.translations.{lang}",
                        f"Approved bridge translation is required for {lang}",
                        segment_id,
                    )
                )
            if not any(audio.lang == lang and audio.public_url for audio in segment.audio_files):
                issues.append(
                    ReadinessIssue(
                        "missing_bridge_audio",
                        f"segments.{segment.position}.audio.{lang}",
                        f"Bridge audio is required for {lang}",
                        segment_id,
                    )
                )

    expected_leg_count = max(0, len(text_segments) - 1)
    routing_payload = route_routing_payload(route)
    routing_current = bool(route.routing_hash) and route.routing_hash == route_input_hash(
        routing_payload
    )
    if (
        route.routing_status != RouteRoutingStatus.READY.value
        or len(route.legs) != expected_leg_count
        or not routing_current
    ):
        issues.append(
            ReadinessIssue(
                "routing_stale",
                "legs",
                "Pedestrian geometry must be recalculated for the current narrative order",
            )
        )
    return issues


def serialize_route_readiness(
    route: Route,
    lang: str,
    source_language: str,
) -> dict[str, object]:
    issues = evaluate_route_readiness(route, lang, source_language)
    return {
        "lang": lang,
        "ready": not issues,
        "issues": [issue.serialize() for issue in issues],
    }
