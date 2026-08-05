import argparse
from pathlib import Path

from app.core.db import SessionLocal
from app.services.languages import seed_language_catalog

DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[3] / "docs" / "voice_language_seed.csv"


def seed(path: Path = DEFAULT_CATALOG_PATH) -> dict[str, int]:
    with SessionLocal() as session:
        return seed_language_catalog(session, path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed languages and ElevenLabs voices")
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_CATALOG_PATH)
    args = parser.parse_args()
    result = seed(args.path)
    print(
        "Language catalog seeded: "
        f"{result['languages']} languages, {result['voices']} voices, "
        f"{result['associations']} associations"
    )


if __name__ == "__main__":
    main()
