"""
Single source of truth for backend configuration.

Every setting is read from `backend/.env.backend` exactly once, here, at import
time. Modules import the resolved values from this module rather than calling
`load_dotenv` and `os.environ` themselves.

This exists because the per-module approach drifted: four modules each loaded a
different filename (`.env`, `.env.local`, `.env.backend`, and one that passed a
directory), three of which did not exist. `load_dotenv` returns False for a
missing file instead of raising, so the whole thing failed silently and every
setting fell back to its placeholder default.

Two rules keep that from recurring:

  - One env file, named once, in `ENV_PATH`.
  - Path-valued settings resolve against `BACKEND_DIR`, not the process working
    directory, so the app behaves the same however it is launched.
"""

import os
from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_DIR / ".env.backend"


@lru_cache(maxsize=1)
def load_backend_env() -> bool:
    """Load the backend env file once while preserving process overrides."""
    return load_dotenv(ENV_PATH)


ENV_FILE_LOADED = load_backend_env()


class ConfigError(Exception):
    """A required setting is missing, or its file can't be found."""


def _resolve_path(name: str) -> str | None:
    """
    Read a path-valued setting and make it absolute.

    Values like `./gcp-key.json` are relative to `backend/`, which is only the
    working directory when the app happens to be launched from there. Anchoring
    to BACKEND_DIR makes `uvicorn` work from the repo root too.
    """
    raw = os.environ.get(name)
    if not raw:
        return None

    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = BACKEND_DIR / path

    return str(path.resolve())


# ---- Google Cloud -----------------------------------------------------------

SERVICE_ACCOUNT_KEY_PATH = _resolve_path("SERVICE_ACCOUNT_KEY_PATH")
GOOGLE_APPLICATION_CREDENTIALS = _resolve_path("GOOGLE_APPLICATION_CREDENTIALS")

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
GCS_BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME")
GCS_DESTINATION_PREFIX = os.environ.get("GCS_DESTINATION_PREFIX", "uploads/")
GCS_DESTINATION_PREFIX_MAPPING = os.environ.get(
    "GCS_DESTINATION_PREFIX_MAPPING", "mappings/"
)

# Google's client libraries read this variable straight out of the environment
# when falling back to Application Default Credentials, and they get no say in
# what it is relative to. Write the absolute form back so an ADC code path and
# an explicit-credentials code path resolve to the same file.
if GOOGLE_APPLICATION_CREDENTIALS:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = GOOGLE_APPLICATION_CREDENTIALS

# ---- BigQuery ---------------------------------------------------------------

BQ_FAIRPRICESELLOUT_TABLE = os.environ.get(
    "BQ_FAIRPRICESELLOUT_TABLE", "aire-data.Aire_Data.aireOS_fairprice"
)

# Weekly sell-out the dashboard reads: a normalized table of retailer_id,
# store_code and sku rows (names come from the Cloud SQL catalog).
BQ_SELLOUT_TABLE = os.environ.get(
    "BQ_SELLOUT_TABLE", "aire-data.Aire_Data.public_sellout"
)

# Final forecast the Forecast page reads: one row per customer x SKU x month
# with the initial / previous / current lines, cartons only. Read-only; written
# by the BigQuery procedure run_monthly_forecast_pipeline.
BQ_FORECAST_OUTPUT_VIEW = os.environ.get(
    "BQ_FORECAST_OUTPUT_VIEW",
    "aire-data.Aire_Data_Analytics.aire_forecasting_output",
)

# ---- Cloud SQL --------------------------------------------------------------

POSTGRESQL_INSTANCE_CONNECTION_NAME = os.environ.get(
    "POSTGRESQL_INSTANCE_CONNECTION_NAME"
)
DB_IAM_USER = os.environ.get("DB_IAM_USER")
DB_NAME = os.environ.get("DB_NAME")


def cloud_sql_loading_enabled() -> bool:
    """Return whether validated uploads should be persisted to Cloud SQL."""
    return os.environ.get("CLOUD_SQL_LOAD_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

# ---- Anthropic --------------------------------------------------------------

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")


# ---- Access helpers ---------------------------------------------------------

def require(name: str) -> str:
    """
    Return a setting's value, or raise ConfigError explaining what to fix.

    Use this at the point of use rather than asserting at import time, so a
    missing setting fails the one request that needs it instead of preventing
    the app from starting.
    """
    value = globals().get(name)
    if value:
        return value

    if not ENV_FILE_LOADED:
        raise ConfigError(
            f"{name} is not set: no env file found at {ENV_PATH}. "
        )

    raise ConfigError(f"{name} is not set in {ENV_PATH}")


def require_file(name: str) -> str:
    """Like `require`, but also checks the path actually exists on disk."""
    path = require(name)
    if not os.path.exists(path):
        raise ConfigError(f"{name} points to a file that does not exist: {path}")
    return path
