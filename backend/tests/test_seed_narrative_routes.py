from sqlalchemy import func, select

from app.models.entities import (
    AudioGenerationJob,
    AudioGenerationJobItem,
    Author,
    Point,
    Route,
    RouteItem,
    Text,
)
from app.models.enums import RouteSegmentKind
from app.scripts.seed_narrative_routes import queue_missing_route_audio, seed_do_tejo_ao_chiado


def test_seed_is_idempotent_and_preserves_narrative_order(db_session):
    first = seed_do_tejo_ao_chiado(db_session, environment="development")
    db_session.commit()
    assert first is not None
    first_id = first.id
    counts = {
        "authors": db_session.scalar(select(func.count()).select_from(Author)),
        "points": db_session.scalar(select(func.count()).select_from(Point)),
        "texts": db_session.scalar(select(func.count()).select_from(Text)),
        "segments": db_session.scalar(select(func.count()).select_from(RouteItem)),
    }

    second = seed_do_tejo_ao_chiado(db_session, environment="staging")
    db_session.commit()
    assert second is not None
    assert second.id == first_id
    assert counts == {
        "authors": db_session.scalar(select(func.count()).select_from(Author)),
        "points": db_session.scalar(select(func.count()).select_from(Point)),
        "texts": db_session.scalar(select(func.count()).select_from(Text)),
        "segments": db_session.scalar(select(func.count()).select_from(RouteItem)),
    }
    segments = list(
        db_session.scalars(
            select(RouteItem).where(RouteItem.route_id == first_id).order_by(RouteItem.position)
        )
    )
    assert len(segments) == 9
    assert [segment.position for segment in segments] == list(range(9))
    assert [segment.kind for segment in segments] == [
        RouteSegmentKind.BRIDGE.value,
        RouteSegmentKind.TEXT.value,
        RouteSegmentKind.BRIDGE.value,
        RouteSegmentKind.TEXT.value,
        RouteSegmentKind.BRIDGE.value,
        RouteSegmentKind.TEXT.value,
        RouteSegmentKind.BRIDGE.value,
        RouteSegmentKind.TEXT.value,
        RouteSegmentKind.BRIDGE.value,
    ]
    assert [segment.text.author.name for segment in segments if segment.text] == [
        "Almeida Garrett",
        "Fernando Pessoa / Bernardo Soares",
        "Eça de Queirós",
        "Alberto Pimentel",
    ]


def test_seed_refuses_non_development_environments(db_session):
    assert seed_do_tejo_ao_chiado(db_session, environment="production") is None
    assert db_session.scalar(select(Route).where(Route.slug == "do-tejo-ao-chiado")) is None


def test_audio_is_queued_after_seed_without_duplicate_jobs(db_session):
    route = seed_do_tejo_ao_chiado(db_session, environment="development")
    db_session.commit()
    assert route is not None

    queue_missing_route_audio(db_session, route)
    first_counts = (
        db_session.scalar(select(func.count()).select_from(AudioGenerationJob)),
        db_session.scalar(select(func.count()).select_from(AudioGenerationJobItem)),
    )
    queue_missing_route_audio(db_session, route)
    assert first_counts == (4, 18)
    assert first_counts == (
        db_session.scalar(select(func.count()).select_from(AudioGenerationJob)),
        db_session.scalar(select(func.count()).select_from(AudioGenerationJobItem)),
    )
