from dataclasses import dataclass
from pathlib import Path


@dataclass
class R2Service:
    storage_dir: str = "media"
    public_base_url: str = "/media"

    def upload_audio(self, key: str, content: bytes) -> str:
        relative_key = key.removeprefix("/")
        destination = Path(self.storage_dir) / relative_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        return f"{self.public_base_url.rstrip('/')}/{relative_key}"

    def delete_audio(self, key: str) -> None:
        relative_key = key.removeprefix("/")
        path = Path(self.storage_dir) / relative_key
        if path.exists():
            path.unlink()
