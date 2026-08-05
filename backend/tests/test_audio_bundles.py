import io
import json
import zipfile
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.models.entities import AudioFile, Text
from app.services.audio_bundles import parse_bundle
from app.services.audio_recipes import build_generation_spec, recipe_hash, sha256_bytes
from tests.test_admin_content import auth_header
from tests.test_api_public import seed_public_data

MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00portable-audio"


def test_recipe_hash_is_canonical_and_normalizes_unicode_and_newlines() -> None:
    composed = build_generation_spec(
        source_text="Lisboa\r\né",
        language="pt",
        voice_id="voice",
        model_id="model",
        output_format="mp3_44100_128",
        pronunciation_dictionary=None,
    )
    decomposed = build_generation_spec(
        source_text="Lisboa\ne\u0301",
        language="pt",
        voice_id="voice",
        model_id="model",
        output_format="mp3_44100_128",
        pronunciation_dictionary=None,
    )
    assert recipe_hash(composed) == recipe_hash(dict(reversed(list(decomposed.items()))))
    assert recipe_hash({**composed, "voice_id": "other"}) != recipe_hash(composed)


def test_export_import_round_trip_is_idempotent(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    generated = client.post(
        f"/api/v1/admin/audio/{text.id}/pt/generate?voice_id=voice-default",
        headers=headers,
    )
    assert generated.status_code == 200
    audio = db_session.query(AudioFile).filter_by(text_id=text.id, lang="pt").one()
    path = Path(get_settings().audio_storage_dir) / str(audio.r2_key)
    path.write_bytes(MP3)
    audio.content_hash = sha256_bytes(MP3)
    db_session.commit()

    preview = client.post(
        "/api/v1/admin/audio-bundles/export/preview",
        headers=headers,
        json={"text_ids": [str(text.id)]},
    )
    assert preview.status_code == 200
    assert preview.json()["data"]["counts"]["exportable"] == 1
    exported = client.post(
        "/api/v1/admin/audio-bundles/export",
        headers=headers,
        json={"text_ids": [str(text.id)]},
    )
    assert exported.status_code == 200

    deleted = client.delete(f"/api/v1/admin/audio/{text.id}/pt", headers=headers)
    assert deleted.status_code == 200
    files = {"file": ("bundle.zip", exported.content, "application/zip")}
    imported_preview = client.post(
        "/api/v1/admin/audio-bundles/import/preview", headers=headers, files=files
    )
    assert imported_preview.status_code == 200
    assert imported_preview.json()["data"]["counts"]["create"] == 1
    confirmed = client.post(
        "/api/v1/admin/audio-bundles/import/confirm", headers=headers, files=files
    )
    assert confirmed.status_code == 200
    restored = db_session.query(AudioFile).filter_by(text_id=text.id, lang="pt").one()
    assert Path(get_settings().audio_storage_dir, str(restored.r2_key)).read_bytes() == MP3
    playback = client.get(str(restored.public_url))
    assert playback.status_code == 200
    assert playback.content == MP3
    repeated = client.post(
        "/api/v1/admin/audio-bundles/import/preview", headers=headers, files=files
    )
    assert repeated.json()["data"]["counts"]["already_current"] == 1


def test_manual_audio_is_preserved_during_import(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    spec = build_generation_spec(
        source_text=text.phonetic_content or text.content_pt,
        language="pt",
        voice_id="voice-default",
        model_id=get_settings().elevenlabs_model_id,
        output_format=get_settings().elevenlabs_output_format,
        pronunciation_dictionary=None,
    )
    bundle = _bundle(spec, MP3)
    upload = client.put(
        f"/api/v1/admin/audio/{text.id}/pt/upload",
        headers=headers,
        files={"file": ("manual.mp3", MP3, "audio/mpeg")},
    )
    assert upload.status_code == 200
    preview = client.post(
        "/api/v1/admin/audio-bundles/import/preview",
        headers=headers,
        files={"file": ("bundle.zip", bundle, "application/zip")},
    )
    assert preview.json()["data"]["counts"]["preserve_manual"] == 1


def test_bundle_rejects_traversal_and_bad_content_hash() -> None:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr(
            "manifest.json", json.dumps({"schema": "lisboa-audio-bundle/v1", "artifacts": []})
        )
        archive.writestr("../escape.mp3", MP3)
    with pytest.raises(ValueError, match="unsafe path"):
        parse_bundle(stream.getvalue(), max_bytes=1024 * 1024, max_entries=10)


def _bundle(spec: dict[str, object], content: bytes) -> bytes:
    signature = recipe_hash(spec)
    path = f"artifacts/{signature}.mp3"
    manifest = {
        "schema": "lisboa-audio-bundle/v1",
        "artifacts": [
            {
                "recipe_hash": signature,
                "content_hash": sha256_bytes(content),
                "generation_spec": spec,
                "size_bytes": len(content),
                "duration_s": 1.0,
                "path": path,
            }
        ],
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr(path, content)
    return stream.getvalue()
