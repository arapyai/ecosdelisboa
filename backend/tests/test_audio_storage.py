from uuid import uuid4

import pytest

from app.services.audio_storage import AudioStorage, generated_audio_key, manual_audio_key


def test_audio_keys_share_text_and_language_naming() -> None:
    text_id = uuid4()

    signature = "a" * 64
    assert generated_audio_key(text_id, "en", signature) == (
        f"audio/generated/{text_id}/en/{signature}.mp3"
    )
    assert manual_audio_key(text_id, "en") == f"audio/manual/{text_id}/en.mp3"


def test_audio_storage_atomically_replaces_deterministic_key(tmp_path) -> None:
    storage = AudioStorage(storage_dir=str(tmp_path), public_base_url="/media")
    key = manual_audio_key(uuid4(), "pt")

    first_url = storage.upload_audio(key, b"first")
    second_url = storage.upload_audio(key, b"second")
    stored_path = tmp_path / key

    assert first_url == second_url == f"/media/{key}"
    assert stored_path.read_bytes() == b"second"
    assert list(stored_path.parent.iterdir()) == [stored_path]

    storage.delete_audio(key)
    assert not stored_path.exists()
    assert not stored_path.parent.exists()


def test_audio_storage_rejects_keys_outside_configured_directory(tmp_path) -> None:
    storage = AudioStorage(storage_dir=str(tmp_path), public_base_url="/media")

    with pytest.raises(ValueError, match="escapes"):
        storage.upload_audio("../outside.mp3", b"content")
