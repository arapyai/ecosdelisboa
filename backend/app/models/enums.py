from enum import StrEnum


class ContentType(StrEnum):
    PROSE = "prose"
    POETRY = "poetry"
    LYRICS = "lyrics"


class TextOrigin(StrEnum):
    MANUAL = "manual"
    IMPORT = "import"
    AUTOMATIC = "automatic"


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


class RouteSegmentKind(StrEnum):
    TEXT = "text"
    BRIDGE = "bridge"
    LEGACY = "legacy"


class RouteRoutingStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"
    STALE = "stale"
    FAILED = "failed"
