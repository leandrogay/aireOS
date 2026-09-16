"""Load the backend's local environment once, preserving process overrides."""

from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


@lru_cache(maxsize=1)
def load_backend_env() -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env.backend")
