from __future__ import annotations

from datetime import datetime
from enum import Enum as PythonEnum
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy import (
    Text as SAText,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    AudioJobItemStatus,
    AudioJobStatus,
    ContentType,
    RouteRoutingStatus,
    RouteSegmentKind,
    TextOrigin,
    TranslationStatus,
)
from app.models.sqltypes import GeometryPoint4326


def value_enum(enum_class: type[PythonEnum], name: str) -> Enum:
    return Enum(
        enum_class,
        name=name,
        values_callable=lambda enum_items: [item.value for item in enum_items],
    )


class AdminUser(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "admin_users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


voice_languages = Table(
    "voice_languages",
    Base.metadata,
    Column("voice_id", Uuid, ForeignKey("voices.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "language_code",
        String(16),
        ForeignKey("languages.code", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Language(CreatedAtMixin, Base):
    __tablename__ = "languages"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    locale: Mapped[str] = mapped_column(String(35), unique=True, nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_source: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    voices: Mapped[list[Voice]] = relationship(
        secondary=voice_languages,
        back_populates="languages",
    )

    __table_args__ = (
        Index(
            "uq_languages_single_source",
            "is_source",
            unique=True,
            postgresql_where=text("is_source"),
            sqlite_where=text("is_source = 1"),
        ),
    )


class PronunciationDictionary(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "pronunciation_dictionaries"

    language_code: Mapped[str] = mapped_column(
        String(16),
        ForeignKey("languages.code", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    elevenlabs_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    version_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    last_published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_published_by: Mapped[str | None] = mapped_column(String(320), nullable=True)


class Voice(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "voices"

    elevenlabs_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    preview_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    languages: Mapped[list[Language]] = relationship(
        secondary=voice_languages,
        back_populates="voices",
    )


class Author(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "authors"

    name: Mapped[str] = mapped_column(SAText, nullable=False)
    bio_pt: Mapped[str | None] = mapped_column(SAText, nullable=True)
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    death_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    elevenlabs_voice_id: Mapped[str | None] = mapped_column(
        ForeignKey("voices.elevenlabs_id", ondelete="SET NULL"), nullable=True
    )

    texts: Mapped[list[Text]] = relationship(
        back_populates="author",
        cascade="all, delete-orphan",
    )
    translations: Mapped[list[AuthorTranslation]] = relationship(
        back_populates="author",
        cascade="all, delete-orphan",
    )


class Point(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "points"

    title_pt: Mapped[str] = mapped_column(SAText, nullable=False)
    address: Mapped[str | None] = mapped_column(SAText, nullable=True)
    neighborhood: Mapped[str | None] = mapped_column(SAText, nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[str | None] = mapped_column(GeometryPoint4326(), nullable=True)
    review_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)

    texts: Mapped[list[Text]] = relationship(back_populates="point", cascade="all, delete-orphan")


class PointReviewCodeCounter(Base):
    __tablename__ = "point_review_code_counters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, nullable=False)


class Text(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "texts"

    point_id: Mapped[UUID] = mapped_column(
        ForeignKey("points.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[UUID] = mapped_column(
        ForeignKey("authors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content_pt: Mapped[str] = mapped_column(SAText, nullable=False)
    phonetic_content: Mapped[str | None] = mapped_column(SAText, nullable=True)
    source_work: Mapped[str | None] = mapped_column(SAText, nullable=True)
    source_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_type: Mapped[ContentType] = mapped_column(
        value_enum(ContentType, "content_type"), nullable=False
    )
    origin: Mapped[str] = mapped_column(String(16), default=TextOrigin.MANUAL.value, nullable=False)

    point: Mapped[Point] = relationship(back_populates="texts")
    author: Mapped[Author] = relationship(back_populates="texts")
    translations: Mapped[list[Translation]] = relationship(
        back_populates="text", cascade="all, delete-orphan"
    )
    audio_files: Mapped[list[AudioFile]] = relationship(
        back_populates="text", cascade="all, delete-orphan"
    )
    route_segments: Mapped[list[RouteItem]] = relationship(back_populates="text")


class Translation(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "translations"

    text_id: Mapped[UUID] = mapped_column(
        ForeignKey("texts.id", ondelete="CASCADE"),
        nullable=False,
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    content: Mapped[str] = mapped_column(SAText, nullable=False)
    phonetic_content: Mapped[str | None] = mapped_column(SAText, nullable=True)
    status: Mapped[TranslationStatus] = mapped_column(
        value_enum(TranslationStatus, "translation_status"),
        default=TranslationStatus.PENDING,
        nullable=False,
    )
    auto_translated: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    origin: Mapped[str] = mapped_column(
        String(16), default=TextOrigin.AUTOMATIC.value, nullable=False
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    text: Mapped[Text] = relationship(back_populates="translations")

    __table_args__ = (UniqueConstraint("text_id", "lang", name="uq_translations_text_lang"),)


class AudioFile(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "audio_files"

    text_id: Mapped[UUID] = mapped_column(
        ForeignKey("texts.id", ondelete="CASCADE"),
        nullable=False,
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    r2_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    voice_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    manually_uploaded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recipe_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    generation_spec: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)

    text: Mapped[Text] = relationship(back_populates="audio_files")

    __table_args__ = (UniqueConstraint("text_id", "lang", name="uq_audio_files_text_lang"),)


class Route(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "routes"

    title_pt: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    description_pt: Mapped[str | None] = mapped_column(SAText, nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    estimated_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_duration_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    routing_status: Mapped[str] = mapped_column(
        String(32), default=RouteRoutingStatus.PENDING.value, nullable=False
    )
    routing_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    routing_error: Mapped[str | None] = mapped_column(SAText, nullable=True)
    migration_status: Mapped[str] = mapped_column(String(32), default="ready", nullable=False)
    routed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list[RouteItem]] = relationship(
        back_populates="route", cascade="all, delete-orphan", order_by="RouteItem.position"
    )
    translations: Mapped[list[RouteTranslation]] = relationship(
        back_populates="route",
        cascade="all, delete-orphan",
    )
    legs: Mapped[list[RouteLeg]] = relationship(
        back_populates="route", cascade="all, delete-orphan", order_by="RouteLeg.position"
    )


class AuthorTranslation(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "author_translations"

    author_id: Mapped[UUID] = mapped_column(
        ForeignKey("authors.id", ondelete="CASCADE"), nullable=False
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    bio: Mapped[str] = mapped_column(SAText, nullable=False)
    status: Mapped[TranslationStatus] = mapped_column(
        value_enum(TranslationStatus, "translation_status"),
        default=TranslationStatus.PENDING,
        nullable=False,
    )
    auto_translated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    origin: Mapped[str] = mapped_column(String(16), default=TextOrigin.MANUAL.value, nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    author: Mapped[Author] = relationship(back_populates="translations")

    __table_args__ = (
        UniqueConstraint("author_id", "lang", name="uq_author_translations_author_lang"),
    )


class RouteTranslation(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "route_translations"

    route_id: Mapped[UUID] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), nullable=False
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(SAText, nullable=True)
    status: Mapped[TranslationStatus] = mapped_column(
        value_enum(TranslationStatus, "translation_status"),
        default=TranslationStatus.PENDING,
        nullable=False,
    )
    auto_translated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    origin: Mapped[str] = mapped_column(String(16), default=TextOrigin.MANUAL.value, nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    route: Mapped[Route] = relationship(back_populates="translations")

    __table_args__ = (
        UniqueConstraint("route_id", "lang", name="uq_route_translations_route_lang"),
    )


class RouteItem(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "route_items"

    route_id: Mapped[UUID] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(
        String(16), default=RouteSegmentKind.LEGACY.value, nullable=False
    )
    text_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("texts.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    bridge_content_pt: Mapped[str | None] = mapped_column(SAText, nullable=True)
    point_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("points.id", ondelete="SET NULL"), nullable=True
    )
    waypoint_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    waypoint_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    transition_text_pt: Mapped[str | None] = mapped_column(SAText, nullable=True)

    route: Mapped[Route] = relationship(back_populates="items")
    point: Mapped[Point | None] = relationship()
    text: Mapped[Text | None] = relationship(back_populates="route_segments")
    translations: Mapped[list[RouteSegmentTranslation]] = relationship(
        back_populates="segment", cascade="all, delete-orphan"
    )
    audio_files: Mapped[list[RouteSegmentAudioFile]] = relationship(
        back_populates="segment", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "(kind = 'text' AND text_id IS NOT NULL AND bridge_content_pt IS NULL) OR "
            "(kind = 'bridge' AND text_id IS NULL AND bridge_content_pt IS NOT NULL) OR "
            "(kind = 'legacy' AND ((point_id IS NOT NULL) OR "
            "(waypoint_lat IS NOT NULL AND waypoint_lng IS NOT NULL)))",
            name="segment_payload",
        ),
        UniqueConstraint("route_id", "position", name="uq_route_items_route_position"),
    )


class RouteSegmentTranslation(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "route_segment_translations"

    segment_id: Mapped[UUID] = mapped_column(
        ForeignKey("route_items.id", ondelete="CASCADE"), nullable=False
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    content: Mapped[str] = mapped_column(SAText, nullable=False)
    status: Mapped[TranslationStatus] = mapped_column(
        value_enum(TranslationStatus, "route_segment_translation_status"),
        default=TranslationStatus.PENDING,
        nullable=False,
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    segment: Mapped[RouteItem] = relationship(back_populates="translations")

    __table_args__ = (
        UniqueConstraint("segment_id", "lang", name="uq_route_segment_translations_segment_lang"),
    )


class RouteSegmentAudioFile(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "route_segment_audio_files"

    segment_id: Mapped[UUID] = mapped_column(
        ForeignKey("route_items.id", ondelete="CASCADE"), nullable=False
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    r2_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    voice_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    manually_uploaded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    segment: Mapped[RouteItem] = relationship(back_populates="audio_files")

    __table_args__ = (
        UniqueConstraint("segment_id", "lang", name="uq_route_segment_audio_segment_lang"),
    )


class RouteLeg(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "route_legs"

    route_id: Mapped[UUID] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    from_segment_id: Mapped[UUID] = mapped_column(
        ForeignKey("route_items.id", ondelete="CASCADE"), nullable=False
    )
    to_segment_id: Mapped[UUID] = mapped_column(
        ForeignKey("route_items.id", ondelete="CASCADE"), nullable=False
    )
    geometry: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    waypoints: Mapped[list[dict[str, float]]] = mapped_column(JSON, default=list, nullable=False)
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    duration_s: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)

    route: Mapped[Route] = relationship(back_populates="legs")
    from_segment: Mapped[RouteItem] = relationship(foreign_keys=[from_segment_id])
    to_segment: Mapped[RouteItem] = relationship(foreign_keys=[to_segment_id])

    __table_args__ = (
        UniqueConstraint("route_id", "position", name="uq_route_legs_route_position"),
    )


class AudioGenerationJob(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "audio_generation_jobs"

    status: Mapped[AudioJobStatus] = mapped_column(
        value_enum(AudioJobStatus, "audio_job_status"),
        default=AudioJobStatus.PENDING,
        nullable=False,
    )
    requested_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    batch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("content_generation_batches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    batch_stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    policy: Mapped[str] = mapped_column(String(32), default="replace_automatic", nullable=False)
    preferred_voice_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    succeeded: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(SAText, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list[AudioGenerationJobItem]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    batch: Mapped[ContentGenerationBatch | None] = relationship(back_populates="audio_jobs")

    __table_args__ = (Index("ix_audio_generation_jobs_status_created_at", "status", "created_at"),)


class AudioGenerationJobItem(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "audio_generation_job_items"

    job_id: Mapped[UUID] = mapped_column(
        ForeignKey("audio_generation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    text_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("texts.id", ondelete="CASCADE"),
        nullable=True,
    )
    route_segment_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("route_items.id", ondelete="CASCADE"),
        nullable=True,
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[AudioJobItemStatus] = mapped_column(
        value_enum(AudioJobItemStatus, "audio_job_item_status"),
        default=AudioJobItemStatus.PENDING,
        nullable=False,
    )
    error_message: Mapped[str | None] = mapped_column(SAText, nullable=True)
    was_skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    job: Mapped[AudioGenerationJob] = relationship(back_populates="items")
    text: Mapped[Text | None] = relationship()
    route_segment: Mapped[RouteItem | None] = relationship()

    __table_args__ = (
        CheckConstraint(
            "(text_id IS NOT NULL AND route_segment_id IS NULL) OR "
            "(text_id IS NULL AND route_segment_id IS NOT NULL)",
            name="content_target",
        ),
        UniqueConstraint("job_id", "text_id", "lang", name="uq_audio_job_item_job_text_lang"),
        UniqueConstraint(
            "job_id",
            "route_segment_id",
            "lang",
            name="uq_audio_job_item_job_route_segment_lang",
        ),
    )


class ContentGenerationBatch(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "content_generation_batches"

    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    current_stage: Mapped[str] = mapped_column(
        String(32), default="generating_translations", nullable=False
    )
    requested_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="texts", nullable=False)
    voice_overrides: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    auto_approve_translations: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    generate_translated_audio: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    translation_jobs: Mapped[list[TranslationGenerationJob]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )
    audio_jobs: Mapped[list[AudioGenerationJob]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class TranslationGenerationJob(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "translation_generation_jobs"

    batch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("content_generation_batches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    requested_by: Mapped[str | None] = mapped_column(String(320), nullable=True)
    policy: Mapped[str] = mapped_column(String(32), default="missing_only", nullable=False)
    total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    succeeded: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(SAText, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    batch: Mapped[ContentGenerationBatch | None] = relationship(back_populates="translation_jobs")
    items: Mapped[list[TranslationGenerationJobItem]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_translation_generation_jobs_status_created_at", "status", "created_at"),
    )


class TranslationGenerationJobItem(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "translation_generation_job_items"

    job_id: Mapped[UUID] = mapped_column(
        ForeignKey("translation_generation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    text_id: Mapped[UUID] = mapped_column(
        ForeignKey("texts.id", ondelete="CASCADE"), nullable=False
    )
    lang: Mapped[str] = mapped_column(
        String(16), ForeignKey("languages.code", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    error_message: Mapped[str | None] = mapped_column(SAText, nullable=True)
    was_skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    job: Mapped[TranslationGenerationJob] = relationship(back_populates="items")
    text: Mapped[Text] = relationship()

    __table_args__ = (
        UniqueConstraint("job_id", "text_id", "lang", name="uq_translation_job_item_job_text_lang"),
    )
