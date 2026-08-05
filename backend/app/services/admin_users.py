from __future__ import annotations

from pydantic import EmailStr, TypeAdapter

email_adapter = TypeAdapter(EmailStr)


def normalize_admin_email(value: str) -> str:
    return str(email_adapter.validate_python(value.strip())).lower()


def validate_admin_password(value: str) -> str:
    if len(value) < 12:
        raise ValueError("Password must contain at least 12 characters")
    if len(value) > 128:
        raise ValueError("Password must contain at most 128 characters")
    return value
