from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import AudioFile, PronunciationDictionary, Text
from app.services.audio_recipes import canonical_json, recipe_hash, sha256_bytes, source_text_hash
from app.services.audio_storage import AudioStorage, generated_audio_key
from app.services.audio_uploads import validate_mp3_upload
from app.services.elevenlabs import GeneratedAudio, get_audio_source_text, upsert_audio_file

HEX_HASH = re.compile(r"^[0-9a-f]{64}$")
MANIFEST_SCHEMA = "lisboa-audio-bundle/v1"


@dataclass(frozen=True)
class ParsedArtifact:
    recipe_hash: str
    content_hash: str
    generation_spec: dict[str, object]
    size_bytes: int
    duration_s: float | None
    path: str
    content: bytes


def export_preview(db: Session, storage: AudioStorage, text_ids: list[UUID]) -> dict[str, object]:
    texts = _selected_texts(db, text_ids)
    artifacts: dict[str, dict[str, object]] = {}
    rows: list[dict[str, object]] = []
    counts = {"exportable": 0, "missing": 0, "manual": 0, "legacy": 0, "invalid": 0}
    for text in texts:
        if not text.audio_files:
            counts["missing"] += 1
            rows.append(_export_row(text, None, "missing", "Sem áudio"))
        for audio in text.audio_files:
            if audio.manually_uploaded:
                status, reason = "manual", "Upload manual protegido"
            elif not audio.recipe_hash or not audio.content_hash or not audio.generation_spec:
                status, reason = "legacy", "Áudio legado sem assinatura; regenere antes de exportar"
            elif not audio.r2_key or not storage.has_audio(audio.r2_key):
                status, reason = "invalid", "Arquivo não encontrado no storage"
            else:
                content = storage.read_audio(audio.r2_key)
                if sha256_bytes(content) != audio.content_hash:
                    status, reason = "invalid", "Hash do arquivo não confere"
                else:
                    status, reason = "exportable", "Pronto para exportar"
                    artifacts.setdefault(audio.recipe_hash, _manifest_artifact(audio, content))
            counts[status] += 1
            rows.append(_export_row(text, audio, status, reason))
    return {"counts": counts, "rows": rows, "artifact_count": len(artifacts)}


def build_export_bundle(db: Session, storage: AudioStorage, text_ids: list[UUID]) -> bytes:
    texts = _selected_texts(db, text_ids)
    artifacts: dict[str, tuple[dict[str, object], bytes]] = {}
    source_ids: dict[str, list[str]] = {}
    for text in texts:
        for audio in text.audio_files:
            if audio.manually_uploaded or not all(
                (audio.recipe_hash, audio.content_hash, audio.generation_spec, audio.r2_key)
            ):
                continue
            if not storage.has_audio(audio.r2_key):
                continue
            content = storage.read_audio(audio.r2_key)
            if sha256_bytes(content) != audio.content_hash:
                continue
            manifest_audio = _manifest_artifact(audio, content)
            existing = artifacts.get(audio.recipe_hash)
            if existing and existing[0]["content_hash"] != audio.content_hash:
                raise ValueError("Conflicting content hashes for the same recipe")
            artifacts[audio.recipe_hash] = (manifest_audio, content)
            source_ids.setdefault(audio.recipe_hash, []).append(str(text.id))
    manifest_artifacts = []
    for signature, (item, _) in sorted(artifacts.items()):
        item["source_text_ids"] = sorted(source_ids[signature])
        manifest_artifacts.append(item)
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "created_at": datetime.now(UTC).isoformat(),
        "artifacts": manifest_artifacts,
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", canonical_json(manifest))
        for _, (item, content) in sorted(artifacts.items()):
            archive.writestr(str(item["path"]), content)
    return output.getvalue()


def import_preview(
    db: Session,
    bundle: bytes,
    *,
    max_bytes: int,
    max_entries: int,
    storage: AudioStorage,
) -> dict[str, object]:
    artifacts = parse_bundle(bundle, max_bytes=max_bytes, max_entries=max_entries)
    rows = _match_artifacts(db, artifacts, storage)
    counts = {
        key: 0
        for key in (
            "create",
            "replace_automatic",
            "already_current",
            "preserve_manual",
            "unmatched",
            "invalid",
        )
    }
    for row in rows:
        counts[str(row["action"])] += 1
    return {"counts": counts, "rows": rows, "artifact_count": len(artifacts)}


def confirm_import(
    db: Session,
    bundle: bytes,
    *,
    max_bytes: int,
    max_entries: int,
    storage: AudioStorage,
) -> dict[str, object]:
    artifacts = parse_bundle(bundle, max_bytes=max_bytes, max_entries=max_entries)
    by_recipe = {item.recipe_hash: item for item in artifacts}
    rows = _match_artifacts(db, artifacts, storage)
    counts = _action_counts(rows)
    created_keys: list[str] = []
    previous_keys: list[str] = []
    applied = 0
    try:
        for row in rows:
            if row["action"] not in {"create", "replace_automatic"}:
                continue
            artifact = by_recipe[str(row["recipe_hash"])]
            text = db.get(Text, UUID(str(row["text_id"])))
            if text is None:
                continue
            current = db.scalar(
                select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == row["lang"])
            )
            if current is not None and current.manually_uploaded:
                continue
            key = generated_audio_key(text.id, str(row["lang"]), artifact.recipe_hash)
            existed = storage.has_audio(key)
            public_url = storage.upload_audio(key, artifact.content)
            if not existed:
                created_keys.append(key)
            if current is not None and current.r2_key and current.r2_key != key:
                previous_keys.append(current.r2_key)
            upsert_audio_file(
                db,
                text,
                str(row["lang"]),
                GeneratedAudio(
                    artifact.content, artifact.duration_s, str(artifact.generation_spec["voice_id"])
                ),
                key,
                public_url,
                manually_uploaded=False,
                recipe_hash=artifact.recipe_hash,
                content_hash=artifact.content_hash,
                generation_spec=artifact.generation_spec,
            )
            applied += 1
        db.commit()
    except Exception:
        db.rollback()
        for key in created_keys:
            storage.delete_audio(key)
        raise
    for key in set(previous_keys):
        storage.delete_audio(key)
    return {"applied": applied, "counts": counts}


def parse_bundle(bundle: bytes, *, max_bytes: int, max_entries: int) -> list[ParsedArtifact]:
    if not bundle:
        raise ValueError("Audio bundle is empty")
    if len(bundle) > max_bytes:
        raise OverflowError(f"Audio bundle exceeds the {max_bytes}-byte limit")
    stream = io.BytesIO(bundle)
    if not zipfile.is_zipfile(stream):
        raise ValueError("Audio bundle is not a valid ZIP")
    with zipfile.ZipFile(stream) as archive:
        entries = archive.infolist()
        if len(entries) > max_entries:
            raise OverflowError("Audio bundle has too many entries")
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)):
            raise ValueError("Audio bundle contains duplicate paths")
        if sum(entry.file_size for entry in entries) > max_bytes:
            raise OverflowError("Audio bundle exceeds the uncompressed size limit")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (
                path.is_absolute()
                or ".." in path.parts
                or entry.is_dir()
                or (entry.external_attr >> 16) & 0o170000 == 0o120000
            ):
                raise ValueError("Audio bundle contains an unsafe path")
        if "manifest.json" not in names:
            raise ValueError("Audio bundle manifest is missing")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("Audio bundle manifest is invalid") from exc
        if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
            raise ValueError("Unsupported audio bundle schema")
        raw_artifacts = manifest.get("artifacts")
        if not isinstance(raw_artifacts, list):
            raise ValueError("Audio bundle artifacts are invalid")
        parsed: list[ParsedArtifact] = []
        seen: set[str] = set()
        expected_paths = {"manifest.json"}
        for raw in raw_artifacts:
            if not isinstance(raw, dict):
                raise ValueError("Audio bundle artifact is invalid")
            signature = raw.get("recipe_hash")
            content_hash = raw.get("content_hash")
            spec = raw.get("generation_spec")
            path = raw.get("path")
            if (
                not isinstance(signature, str)
                or not HEX_HASH.fullmatch(signature)
                or signature in seen
            ):
                raise ValueError("Audio bundle recipe hash is invalid or duplicated")
            if not isinstance(content_hash, str) or not HEX_HASH.fullmatch(content_hash):
                raise ValueError("Audio bundle content hash is invalid")
            if not isinstance(spec, dict):
                raise ValueError("Audio bundle generation specification is invalid")
            _validate_generation_spec(spec)
            if recipe_hash(spec) != signature:
                raise ValueError("Audio bundle recipe does not match its hash")
            expected_path = f"artifacts/{signature}.mp3"
            if path != expected_path or path not in names:
                raise ValueError("Audio bundle artifact path is invalid")
            content = archive.read(path)
            if len(content) != raw.get("size_bytes") or sha256_bytes(content) != content_hash:
                raise ValueError("Audio bundle artifact content does not match its manifest")
            validate_mp3_upload(
                filename=path, content_type="audio/mpeg", content=content, max_bytes=max_bytes
            )
            duration = raw.get("duration_s")
            if duration is not None and not isinstance(duration, (int, float)):
                raise ValueError("Audio bundle duration is invalid")
            parsed.append(
                ParsedArtifact(
                    signature,
                    content_hash,
                    spec,
                    len(content),
                    float(duration) if duration is not None else None,
                    path,
                    content,
                )
            )
            expected_paths.add(path)
            seen.add(signature)
        if set(names) != expected_paths:
            raise ValueError("Audio bundle contains undeclared files")
        return parsed


def _match_artifacts(
    db: Session, artifacts: list[ParsedArtifact], storage: AudioStorage
) -> list[dict[str, object]]:
    texts = list(
        db.scalars(
            select(Text).options(selectinload(Text.translations), selectinload(Text.audio_files))
        ).unique()
    )
    dictionaries = {
        item.language_code: item for item in db.scalars(select(PronunciationDictionary))
    }
    rows: list[dict[str, object]] = []
    for artifact in artifacts:
        spec = artifact.generation_spec
        language = spec.get("language")
        source_hash = spec.get("source_text_hash")
        matches: list[Text] = []
        if isinstance(language, str) and isinstance(source_hash, str):
            for text in texts:
                try:
                    spoken = get_audio_source_text(db, text, language)
                except ValueError:
                    continue
                if source_text_hash(spoken) != source_hash:
                    continue
                dictionary = dictionaries.get(language)
                expected_dictionary = (
                    None
                    if dictionary is None
                    else {"id": dictionary.elevenlabs_id, "version_id": dictionary.version_id}
                )
                if spec.get("pronunciation_dictionary") != expected_dictionary:
                    continue
                if recipe_hash(spec) != artifact.recipe_hash:
                    continue
                matches.append(text)
        if not matches:
            rows.append(
                {
                    "recipe_hash": artifact.recipe_hash,
                    "lang": language,
                    "text_id": None,
                    "text": None,
                    "action": "unmatched",
                    "reason": "Nenhum texto com receita exata neste ambiente",
                }
            )
            continue
        for text in matches:
            current = next((audio for audio in text.audio_files if audio.lang == language), None)
            if current is None:
                action, reason = "create", "Criar áudio automático"
            elif current.manually_uploaded:
                action, reason = "preserve_manual", "Upload manual será preservado"
            elif (
                current.recipe_hash == artifact.recipe_hash
                and current.content_hash == artifact.content_hash
                and current.r2_key
                and storage.has_audio(current.r2_key)
            ):
                action, reason = "already_current", "Áudio já está atualizado"
            else:
                action, reason = "replace_automatic", "Substituir áudio automático"
            rows.append(
                {
                    "recipe_hash": artifact.recipe_hash,
                    "lang": language,
                    "text_id": str(text.id),
                    "text": text.content_pt[:100],
                    "action": action,
                    "reason": reason,
                }
            )
    actionable_by_target: dict[tuple[object, object], list[dict[str, object]]] = {}
    for row in rows:
        if row["action"] not in {"create", "replace_automatic"}:
            continue
        key = (row["text_id"], row["lang"])
        actionable_by_target.setdefault(key, []).append(row)
    for candidates in actionable_by_target.values():
        recipes = {row["recipe_hash"] for row in candidates}
        if len(recipes) < 2:
            continue
        for row in candidates:
            row["action"] = "invalid"
            row["reason"] = "Mais de uma receita do pacote corresponde a este texto e idioma"
    return rows


def _action_counts(rows: list[dict[str, object]]) -> dict[str, int]:
    actions = (
        "create",
        "replace_automatic",
        "already_current",
        "preserve_manual",
        "unmatched",
        "invalid",
    )
    counts = {key: 0 for key in actions}
    for row in rows:
        counts[str(row["action"])] += 1
    return counts


def _validate_generation_spec(spec: dict[str, object]) -> None:
    required = {
        "schema_version",
        "provider",
        "model_id",
        "output_format",
        "voice_id",
        "language",
        "source_text_hash",
        "pronunciation_dictionary",
        "voice_settings",
    }
    if set(spec) != required:
        raise ValueError("Audio bundle generation specification has unknown or missing fields")
    if spec["schema_version"] != 1 or spec["provider"] != "elevenlabs":
        raise ValueError("Audio bundle generation specification is unsupported")
    for key in ("model_id", "output_format", "voice_id", "language"):
        if not isinstance(spec[key], str) or not spec[key]:
            raise ValueError("Audio bundle generation specification is invalid")
    if not isinstance(spec["source_text_hash"], str) or not HEX_HASH.fullmatch(
        spec["source_text_hash"]
    ):
        raise ValueError("Audio bundle source text hash is invalid")
    if spec["voice_settings"] != {}:
        raise ValueError("Audio bundle voice settings are unsupported")
    dictionary = spec["pronunciation_dictionary"]
    if dictionary is not None and (
        not isinstance(dictionary, dict)
        or set(dictionary) != {"id", "version_id"}
        or not all(isinstance(value, str) and value for value in dictionary.values())
    ):
        raise ValueError("Audio bundle pronunciation dictionary is invalid")


def _selected_texts(db: Session, text_ids: list[UUID]) -> list[Text]:
    if not text_ids:
        raise ValueError("Select at least one text")
    return list(
        db.scalars(
            select(Text).options(selectinload(Text.audio_files)).where(Text.id.in_(text_ids))
        ).unique()
    )


def _manifest_artifact(audio: AudioFile, content: bytes) -> dict[str, object]:
    return {
        "recipe_hash": audio.recipe_hash,
        "content_hash": audio.content_hash,
        "generation_spec": audio.generation_spec,
        "size_bytes": len(content),
        "duration_s": audio.duration_s,
        "path": f"artifacts/{audio.recipe_hash}.mp3",
    }


def _export_row(text: Text, audio: AudioFile | None, status: str, reason: str) -> dict[str, object]:
    return {
        "text_id": str(text.id),
        "text": text.content_pt[:100],
        "lang": audio.lang if audio else None,
        "status": status,
        "reason": reason,
    }
