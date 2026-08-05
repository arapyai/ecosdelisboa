from __future__ import annotations

import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

from jose import jwt
from jose.exceptions import JWTError

from app.core.config import get_settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    salt_hex, digest_hex = password_hash.split(":", maxsplit=1)
    expected = bytes.fromhex(digest_hex)
    calculated = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 600_000
    )
    return hmac.compare_digest(calculated, expected)


def create_access_token(
    subject: UUID | str,
    *,
    auth_version: int = 0,
    expires_delta: timedelta | None = None,
) -> str:
    settings = get_settings()
    expires_in = expires_delta or timedelta(minutes=settings.admin_access_token_expire_minutes)
    now = datetime.now(UTC)
    payload = {
        "sub": str(subject),
        "ver": auth_version,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_in).timestamp()),
    }
    return jwt.encode(payload, settings.admin_secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, str | int]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.admin_secret_key, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid access token") from exc

    return payload
