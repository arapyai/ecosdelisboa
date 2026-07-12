from enum import StrEnum


class ContentType(StrEnum):
    PROSE = "prose"
    POETRY = "poetry"
    LYRICS = "lyrics"


class TranslationStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class AudioJobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AudioJobItemStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
