import os
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import UUID


def generated_audio_key(text_id: UUID, lang: str, recipe_hash: str) -> str:
    return f"audio/generated/{text_id}/{lang}/{recipe_hash}.mp3"


def manual_audio_key(text_id: UUID, lang: str) -> str:
    return f"audio/manual/{text_id}/{lang}.mp3"


def generated_route_bridge_audio_key(segment_id: UUID, lang: str, recipe_hash: str) -> str:
    return f"audio/routes/generated/{segment_id}/{lang}/{recipe_hash}.mp3"


def manual_route_bridge_audio_key(segment_id: UUID, lang: str) -> str:
    return f"audio/routes/manual/{segment_id}/{lang}.mp3"


@dataclass
class AudioStorage:
    storage_dir: str = "media"
    public_base_url: str = "/media"

    def _path_for_key(self, key: str) -> tuple[str, Path]:
        relative_key = key.removeprefix("/")
        storage_root = Path(self.storage_dir).resolve()
        destination = (storage_root / relative_key).resolve()
        if not destination.is_relative_to(storage_root):
            raise ValueError("Audio storage key escapes the configured directory")
        return relative_key, destination

    def upload_audio(self, key: str, content: bytes) -> str:
        relative_key, destination = self._path_for_key(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with NamedTemporaryFile(dir=destination.parent, delete=False) as temporary_file:
                temporary_file.write(content)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
                temporary_path = Path(temporary_file.name)
            os.replace(temporary_path, destination)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        return f"{self.public_base_url.rstrip('/')}/{relative_key}"

    def read_audio(self, key: str) -> bytes:
        _, path = self._path_for_key(key)
        return path.read_bytes()

    def has_audio(self, key: str) -> bool:
        _, path = self._path_for_key(key)
        return path.is_file()

    def delete_audio(self, key: str) -> None:
        _, path = self._path_for_key(key)
        if path.exists():
            path.unlink()
        storage_root = Path(self.storage_dir).resolve()
        parent = path.parent
        while parent != storage_root:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
