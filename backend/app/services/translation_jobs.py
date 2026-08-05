from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from threading import Event, Thread
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload, sessionmaker

from app.models.entities import (
    ContentGenerationBatch,
    Text,
    TranslationGenerationJob,
    TranslationGenerationJobItem,
)
from app.models.enums import TextOrigin, TranslationStatus
from app.services.content_batches import queue_approved_translated_audio
from app.services.llm import LLMTranslationService, request_translation

logger = logging.getLogger(__name__)


def create_translation_job(
    db: Session,
    requested_by: str | None,
    items: list[tuple[UUID, str]],
    *,
    batch_id: UUID | None = None,
    policy: str = "missing_only",
) -> TranslationGenerationJob:
    job = TranslationGenerationJob(
        created_at=datetime.now(UTC),
        requested_by=requested_by,
        batch_id=batch_id,
        policy=policy,
        status="pending",
        total=len(items),
    )
    db.add(job)
    db.flush()
    for text_id, lang in dict.fromkeys(items):
        db.add(TranslationGenerationJobItem(job_id=job.id, text_id=text_id, lang=lang))
    job.total = len(dict.fromkeys(items))
    db.commit()
    db.refresh(job)
    return job


def claim_next_translation_job(db: Session) -> UUID | None:
    job_id = db.scalar(
        select(TranslationGenerationJob.id)
        .where(TranslationGenerationJob.status == "pending")
        .order_by(TranslationGenerationJob.created_at, TranslationGenerationJob.id)
        .limit(1)
    )
    if job_id is None:
        return None
    result = db.execute(
        update(TranslationGenerationJob)
        .where(
            TranslationGenerationJob.id == job_id,
            TranslationGenerationJob.status == "pending",
        )
        .values(status="running", started_at=datetime.now(UTC), finished_at=None)
    )
    db.commit()
    return job_id if result.rowcount == 1 else None


def recover_interrupted_translation_jobs(db: Session) -> int:
    jobs = list(
        db.scalars(
            select(TranslationGenerationJob)
            .options(selectinload(TranslationGenerationJob.items))
            .where(TranslationGenerationJob.status == "running")
        ).unique()
    )
    for job in jobs:
        for item in job.items:
            if item.status == "running":
                item.status = "pending"
                item.error_message = None
        job.status = (
            "pending" if any(item.status == "pending" for item in job.items) else "completed"
        )
        _refresh_counts(db, job)
    db.commit()
    return len(jobs)


def process_translation_job(
    db: Session,
    job_id: UUID,
    service: LLMTranslationService,
    should_stop: Callable[[], bool] | None = None,
) -> TranslationGenerationJob:
    job = db.scalar(
        select(TranslationGenerationJob)
        .options(selectinload(TranslationGenerationJob.items))
        .where(TranslationGenerationJob.id == job_id)
    )
    if job is None or job.status != "running":
        raise ValueError("Translation job must exist and be running")
    batch = db.get(ContentGenerationBatch, job.batch_id) if job.batch_id else None
    auto_approve = bool(batch and batch.auto_approve_translations)
    for item in sorted(job.items, key=lambda current: (current.created_at, str(current.id))):
        if item.status != "pending":
            continue
        if should_stop is not None and should_stop():
            return job
        item.status = "running"
        item.error_message = None
        db.commit()
        try:
            text = db.scalar(
                select(Text)
                .options(selectinload(Text.author), selectinload(Text.translations))
                .where(Text.id == item.text_id)
            )
            if text is None:
                raise ValueError("Text not found")
            existing = next((value for value in text.translations if value.lang == item.lang), None)
            replaceable = (
                existing is not None
                and existing.origin == TextOrigin.AUTOMATIC.value
                and existing.reviewed_by is None
            )
            if existing is not None and (job.policy == "missing_only" or not replaceable):
                item.was_skipped = True
                translation = existing
            else:
                translation = request_translation(db, text, item.lang, service)
                item.was_skipped = False
            if auto_approve and translation.status != TranslationStatus.APPROVED:
                translation.status = TranslationStatus.APPROVED
                translation.reviewed_by = job.requested_by
                translation.reviewed_at = datetime.now(UTC)
            item.status = "completed"
            _refresh_counts(db, job)
            db.commit()
        except Exception as exc:
            logger.exception("Translation job item failed", extra={"job_id": str(job_id)})
            db.rollback()
            job = db.get(TranslationGenerationJob, job_id)
            item = db.get(TranslationGenerationJobItem, item.id)
            if job is None or item is None:
                raise
            item.status = "failed"
            item.error_message = str(exc)
            job.last_error = str(exc)
            _refresh_counts(db, job)
            db.commit()
    job = db.get(TranslationGenerationJob, job_id)
    if job is None:
        raise ValueError("Translation job not found")
    _refresh_counts(db, job)
    job.status = "failed" if job.failed and not job.succeeded else "completed"
    job.finished_at = datetime.now(UTC)
    db.commit()
    db.refresh(job)
    if auto_approve and batch is not None and batch.generate_translated_audio:
        queue_approved_translated_audio(db, batch, job.requested_by, policy=job.policy)
    return job


def _refresh_counts(db: Session, job: TranslationGenerationJob) -> None:
    counts = dict(
        db.execute(
            select(TranslationGenerationJobItem.status, func.count(TranslationGenerationJobItem.id))
            .where(TranslationGenerationJobItem.job_id == job.id)
            .group_by(TranslationGenerationJobItem.status)
        ).all()
    )
    completed = counts.get("completed", 0)
    job.skipped = (
        db.scalar(
            select(func.count(TranslationGenerationJobItem.id)).where(
                TranslationGenerationJobItem.job_id == job.id,
                TranslationGenerationJobItem.status == "completed",
                TranslationGenerationJobItem.was_skipped.is_(True),
            )
        )
        or 0
    )
    job.succeeded = completed - job.skipped
    job.failed = counts.get("failed", 0)
    job.processed = completed + job.failed


class TranslationJobWorker:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        service: LLMTranslationService,
        poll_interval_s: float = 1.0,
    ) -> None:
        self.session_factory = session_factory
        self.service = service
        self.poll_interval_s = poll_interval_s
        self._stop_event = Event()
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = Thread(target=self.run_forever, name="translation-job-worker", daemon=True)
        self._thread.start()

    def stop(self, timeout_s: float = 5.0) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout_s)

    def run_forever(self) -> None:
        try:
            with self.session_factory() as db:
                recover_interrupted_translation_jobs(db)
        except Exception:
            logger.exception("Could not recover interrupted translation jobs")
        while not self._stop_event.is_set():
            try:
                with self.session_factory() as db:
                    job_id = claim_next_translation_job(db)
                    if job_id is not None:
                        process_translation_job(db, job_id, self.service, self._stop_event.is_set)
                        continue
            except Exception:
                logger.exception("Translation worker iteration failed")
            self._stop_event.wait(self.poll_interval_s)
