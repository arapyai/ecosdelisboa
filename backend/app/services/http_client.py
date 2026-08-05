import os
import ssl
from pathlib import Path
from urllib.request import Request, urlopen

SYSTEM_CA_BUNDLE = Path("/etc/ssl/certs/ca-certificates.crt")


def build_ssl_context() -> ssl.SSLContext | None:
    cafile = os.environ.get("SSL_CERT_FILE")
    if cafile:
        return ssl.create_default_context(cafile=cafile)
    if SYSTEM_CA_BUNDLE.exists():
        return ssl.create_default_context(cafile=str(SYSTEM_CA_BUNDLE))
    return None


def open_url(request: Request, *, timeout: float):
    context = build_ssl_context()
    if request.full_url.startswith("https://") and context is not None:
        return urlopen(request, timeout=timeout, context=context)
    return urlopen(request, timeout=timeout)
