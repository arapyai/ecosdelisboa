from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request

from app.core.config import Settings, get_settings
from app.services.http_client import open_url

Coordinate = tuple[float, float]


class RoutingError(RuntimeError):
    pass


@dataclass(frozen=True)
class DirectionsResult:
    geometry: dict[str, object]
    distance_m: float
    duration_s: int
    provider: str


class DirectionsProvider(Protocol):
    name: str

    def directions(self, coordinates: list[Coordinate]) -> DirectionsResult: ...


@dataclass
class OpenRouteServiceProvider:
    api_key: str
    base_url: str = "https://api.openrouteservice.org"
    timeout_s: float = 15.0
    retry_count: int = 2
    retry_backoff_s: float = 0.25
    name: str = "openrouteservice"

    def directions(self, coordinates: list[Coordinate]) -> DirectionsResult:
        if len(coordinates) < 2:
            raise RoutingError("at least two coordinates are required")
        url = f"{self.base_url.rstrip('/')}/v2/directions/foot-walking/geojson"
        request = Request(
            url,
            data=json.dumps({"coordinates": coordinates}).encode("utf-8"),
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/geo+json, application/json",
            },
            method="POST",
        )
        last_error: Exception | None = None
        for attempt in range(self.retry_count + 1):
            try:
                with open_url(request, timeout=self.timeout_s) as response:
                    return parse_openrouteservice_response(
                        json.loads(response.read().decode("utf-8"))
                    )
            except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
                last_error = exc
                if attempt < self.retry_count and self.retry_backoff_s:
                    time.sleep(self.retry_backoff_s * (attempt + 1))
        raise RoutingError(f"openrouteservice request failed: {last_error}") from last_error


def parse_openrouteservice_response(payload: object) -> DirectionsResult:
    if not isinstance(payload, dict):
        raise ValueError("routing response is invalid")
    features = payload.get("features")
    if not isinstance(features, list) or not features or not isinstance(features[0], dict):
        raise ValueError("routing response has no route feature")
    feature = features[0]
    geometry = feature.get("geometry")
    properties = feature.get("properties")
    summary = properties.get("summary") if isinstance(properties, dict) else None
    if not isinstance(geometry, dict) or not isinstance(summary, dict):
        raise ValueError("routing response is missing geometry or summary")
    if geometry.get("type") != "LineString" or not isinstance(geometry.get("coordinates"), list):
        raise ValueError("routing geometry must be a GeoJSON LineString")
    try:
        distance_m = float(summary["distance"])
        duration_s = round(float(summary["duration"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("routing summary is invalid") from exc
    return DirectionsResult(
        geometry=geometry,
        distance_m=distance_m,
        duration_s=duration_s,
        provider="openrouteservice",
    )


def create_directions_provider(settings: Settings | None = None) -> DirectionsProvider:
    selected = settings or get_settings()
    if selected.routing_provider != "openrouteservice":
        raise RoutingError(f"unsupported routing provider: {selected.routing_provider}")
    if not selected.openrouteservice_api_key:
        raise RoutingError("OPENROUTESERVICE_API_KEY is required")
    return OpenRouteServiceProvider(
        api_key=selected.openrouteservice_api_key,
        base_url=selected.openrouteservice_base_url,
        timeout_s=selected.routing_timeout_s,
        retry_count=selected.routing_retry_count,
        retry_backoff_s=selected.routing_retry_backoff_s,
    )


def route_input_hash(payload: object) -> str:
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
