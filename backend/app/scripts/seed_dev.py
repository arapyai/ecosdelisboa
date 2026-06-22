from __future__ import annotations

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.entities import (
    AdminUser,
    AudioFile,
    Author,
    Point,
    Route,
    RouteItem,
    Text,
    Translation,
    Voice,
)
from app.models.enums import ContentType, SupportedLanguage, TranslationStatus


def get_or_create_voice(session) -> Voice:
    voice = session.scalar(select(Voice).where(Voice.elevenlabs_id == "voice-default-dev"))
    if voice is None:
        voice = Voice(
            elevenlabs_id="voice-default-dev",
            name="Voz Padrao Dev",
            preview_url=None,
            is_default=True,
        )
        session.add(voice)
    else:
        voice.is_default = True
    return voice


def get_or_create_admin(session) -> AdminUser:
    settings = get_settings()
    admin = session.scalar(select(AdminUser).where(AdminUser.email == settings.admin_initial_email))
    if admin is None:
        admin = AdminUser(
            email=settings.admin_initial_email,
            password_hash=hash_password(settings.admin_initial_password),
            is_active=True,
        )
        session.add(admin)
    return admin


def get_or_create_author(
    session,
    *,
    name: str,
    bio_pt: str,
    birth_year: int,
    death_year: int | None,
    voice: Voice,
) -> Author:
    author = session.scalar(select(Author).where(Author.name == name))
    if author is None:
        author = Author(
            name=name,
            bio_pt=bio_pt,
            birth_year=birth_year,
            death_year=death_year,
            elevenlabs_voice_id=voice.elevenlabs_id,
        )
        session.add(author)
    return author


def get_or_create_point(
    session,
    *,
    title_pt: str,
    address: str,
    neighborhood: str,
    lat: float,
    lng: float,
) -> Point:
    point = session.scalar(select(Point).where(Point.title_pt == title_pt))
    if point is None:
        point = Point(
            title_pt=title_pt,
            address=address,
            neighborhood=neighborhood,
            lat=lat,
            lng=lng,
        )
        session.add(point)
    return point


def get_or_create_text(
    session,
    *,
    point: Point,
    author: Author,
    content_pt: str,
    source_work: str,
    source_year: int,
    content_type: ContentType = ContentType.PROSE,
) -> Text:
    text = session.scalar(
        select(Text).where(
            Text.point == point,
            Text.author == author,
            Text.source_work == source_work,
        )
    )
    if text is None:
        text = Text(
            point=point,
            author=author,
            content_pt=content_pt,
            source_work=source_work,
            source_year=source_year,
            content_type=content_type,
        )
        session.add(text)
        session.flush()
        session.add(
            Translation(
                text=text,
                lang=SupportedLanguage.EN,
                content="Sample English translation for development.",
                status=TranslationStatus.APPROVED,
                auto_translated=True,
            )
        )
        session.add(
            AudioFile(
                text=text,
                lang=SupportedLanguage.PT,
                public_url=None,
                duration_s=42.0,
                voice_id="voice-default-dev",
                manually_uploaded=False,
            )
        )
    return text


def get_or_create_route(session, points: list[Point]) -> Route:
    route = session.scalar(select(Route).where(Route.title_pt == "Baixa-Chiado Literario"))
    if route is None:
        route = Route(
            title_pt="Baixa-Chiado Literario",
            description_pt="Percurso demonstrativo entre pracas, cafes e miradouros.",
            difficulty="easy",
            is_published=True,
            estimated_distance_m=1800,
            estimated_duration_s=3300,
        )
        route.items = [
            RouteItem(
                position=index + 1,
                point=point,
                transition_text_pt="Segue para o proximo ponto.",
            )
            for index, point in enumerate(points)
        ]
        session.add(route)
    return route


def seed() -> None:
    with SessionLocal() as session:
        voice = get_or_create_voice(session)
        get_or_create_admin(session)
        session.flush()

        pessoa = get_or_create_author(
            session,
            name="Fernando Pessoa",
            bio_pt="Poeta e escritor associado a multiplas Lisboas interiores.",
            birth_year=1888,
            death_year=1935,
            voice=voice,
        )
        saramago = get_or_create_author(
            session,
            name="Jose Saramago",
            bio_pt="Romancista portugues, Nobel da Literatura, leitor critico da cidade.",
            birth_year=1922,
            death_year=2010,
            voice=voice,
        )
        session.flush()

        chiado = get_or_create_point(
            session,
            title_pt="Chiado",
            address="Largo do Chiado",
            neighborhood="Chiado",
            lat=38.7107,
            lng=-9.1439,
        )
        alfama = get_or_create_point(
            session,
            title_pt="Alfama",
            address="Miradouro de Santa Luzia",
            neighborhood="Alfama",
            lat=38.7117,
            lng=-9.1304,
        )
        praca = get_or_create_point(
            session,
            title_pt="Terreiro do Paco",
            address="Praca do Comercio",
            neighborhood="Baixa",
            lat=38.7076,
            lng=-9.1365,
        )
        session.flush()

        get_or_create_text(
            session,
            point=chiado,
            author=pessoa,
            content_pt="Aqui a cidade tem passos de escritorio, cafe e fantasma.",
            source_work="Fragmento demonstrativo",
            source_year=2026,
        )
        get_or_create_text(
            session,
            point=alfama,
            author=saramago,
            content_pt="As colinas fazem da memoria uma subida.",
            source_work="Fragmento demonstrativo",
            source_year=2026,
        )
        get_or_create_text(
            session,
            point=praca,
            author=pessoa,
            content_pt="O rio abre a cidade como uma pagina larga.",
            source_work="Fragmento demonstrativo",
            source_year=2026,
        )

        get_or_create_route(session, [praca, chiado, alfama])
        session.commit()

    settings = get_settings()
    print("Seed dev concluido.")
    print(f"Admin: {settings.admin_initial_email} / {settings.admin_initial_password}")


if __name__ == "__main__":
    seed()
