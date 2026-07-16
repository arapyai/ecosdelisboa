from fastapi.testclient import TestClient

from app.core.config import get_settings


def test_healthcheck_returns_envelope(client) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "data": {"status": "ok"},
        "meta": {"page": None, "per_page": None, "total": None, "extra": {}},
    }


def test_app_lifecycle_starts_and_stops_audio_worker(monkeypatch, tmp_path) -> None:
    from app import main

    calls: list[str] = []

    class FakeWorker:
        def __init__(self, **_kwargs) -> None:
            pass

        def start(self) -> None:
            calls.append("start")

        def stop(self) -> None:
            calls.append("stop")

    monkeypatch.setenv("AUDIO_STORAGE_DIR", str(tmp_path / "media"))
    get_settings.cache_clear()
    monkeypatch.setattr(main, "AudioJobWorker", FakeWorker)

    app = main.create_app(start_audio_worker=True)
    with TestClient(app) as test_client:
        assert test_client.get("/health").status_code == 200
        assert calls == ["start"]

    assert calls == ["start", "stop"]
