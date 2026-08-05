from pathlib import Path

ALLOWED_MP3_CONTENT_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/x-mpeg",
    "audio/x-mp3",
}


def validate_mp3_upload(
    *,
    filename: str | None,
    content_type: str | None,
    content: bytes,
    max_bytes: int,
) -> None:
    if not filename or Path(filename).suffix.casefold() != ".mp3":
        raise ValueError("Audio file must use the .mp3 extension")
    if content_type not in ALLOWED_MP3_CONTENT_TYPES:
        raise TypeError("Audio file must use an MP3 MIME type")
    if not content:
        raise ValueError("Audio file is empty")
    if len(content) > max_bytes:
        raise OverflowError(f"Audio file exceeds the {max_bytes}-byte limit")
    if not _has_mp3_signature(content):
        raise ValueError("Audio file content is not a valid MP3")


def _has_mp3_signature(content: bytes) -> bool:
    if content.startswith(b"ID3"):
        return True
    return len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0
