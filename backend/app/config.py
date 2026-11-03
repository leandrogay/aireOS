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
GCS_DESTINATION_PREFIX = os.environ.get("GCS_DESTINATION_PREFIX") or "uploads/"
GCS_DESTINATION_PREFIX_MAPPING = os.environ.get("GCS_DESTINATION_PREFIX_MAPPING") or "mappings/"

# Google's client libraries read this variable straight out of the environment
# when falling back to Application Default Credentials, and they get no say in
# what it is relative to. Write the absolute form back so an ADC code path and
# an explicit-credentials code path resolve to the same file.
if GOOGLE_APPLICATION_CREDENTIALS:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = GOOGLE_APPLICATION_CREDENTIALS

# ---- BigQuery ---------------------------------------------------------------

BQ_FAIRPRICESELLOUT_TABLE = (
    os.environ.get("BQ_FAIRPRICESELLOUT_TABLE")
    or "aire-data.Aire_Data.aireOS_fairprice"
)

# Final forecast the Forecast page reads: one row per customer x SKU x month
# with the initial / previous / current lines, cartons only. Read-only; written
# by the BigQuery procedure run_monthly_forecast_pipeline.
BQ_FORECAST_OUTPUT_VIEW = (
    os.environ.get("BQ_FORECAST_OUTPUT_VIEW")
    or "aire-data.Aire_Data_Analytics.aire_forecasting_output"
)

# Weekly sell-out with catalog names joined on (built on the Datastream
# replica of Cloud SQL sellout). The forecast model learns from this.
BQ_SALES_ENRICHED_VIEW = (
    os.environ.get("BQ_SALES_ENRICHED_VIEW")
    or "aire-data.Aire_Data_Analytics.v_sales_enriched"
)

# Forecast model output (predictions only; written out of band by
# scripts/refresh_forecast.py).
BQ_FORECAST_TABLE = (
    os.environ.get("BQ_FORECAST_TABLE")
    or "aire-data.Aire_Data.forecasting_output_xianhui_mock"
)

# Closed monthly sell-out the Forecast page reads its Actual line from.
BQ_MONTHLY_SALES_VIEW = (
    os.environ.get("BQ_MONTHLY_SALES_VIEW")
    or "aire-data.Aire_Data_Analytics.v_customer_monthly_sales"
)

# Final forecast the Forecast page reads: one row per customer x SKU x month
# with the initial / previous / current lines, cartons only. Read-only; written
# by the BigQuery procedure run_monthly_forecast_pipeline.
BQ_FORECAST_OUTPUT_VIEW = (
    os.environ.get("BQ_FORECAST_OUTPUT_VIEW")
    or "aire-data.Aire_Data_Analytics.aire_forecasting_output"
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


def load_confirmation_required() -> bool:
    """
    Return whether a file matching an approved mapping waits for a person to
    press Load instead of loading into sell-out the moment it is uploaded.

    Off by default: uploading a known layout loads it, as it always has. On,
    every load -- not only the first one after an approval -- is a separate,
    confirmed step. Read at call time so a redeploy with the new value is all
    it takes to switch.
    """
    return _enabled(os.environ.get("REQUIRE_LOAD_CONFIRMATION"))

# ---- HTTP -------------------------------------------------------------------

DEFAULT_CORS_ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"


def parse_origins(raw: str) -> list[str]:
    """
    Split a comma-separated origin list, dropping blanks and trailing slashes.

    Browsers send `Origin: https://host` with no trailing slash, so a
    configured `https://host/` would otherwise never match.
    """
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


# Browser origins allowed to call the API with credentials. Behind the cloud
# load balancer the frontend and API share one domain, so production lists
# just that domain; locally it is the Next.js dev server. An empty value (as
# copied from .env.example) means the default, not "allow nobody".
CORS_ALLOWED_ORIGINS = parse_origins(
    os.environ.get("CORS_ALLOWED_ORIGINS") or DEFAULT_CORS_ALLOWED_ORIGINS
)

# ---- Mapping model ----------------------------------------------------------

# Gemini on Vertex AI in GCP_PROJECT_ID, signed in with the same Google
# credentials as BigQuery and GCS -- no API key.
# `or`, not a get() default: .env.example leaves these blank, and a blank value
# must mean "use the default".
# gemini-2.5-* retired on Vertex AI on 2026-10-20; 3.8 Flash is Google's named
# replacement and is listed as available until at least 2027-09-02.
MAPPING_MODEL = os.environ.get("MAPPING_MODEL") or "gemini-3.8-flash"
# "global" is Vertex AI's any-region endpoint: best availability and the newest
# models, but Google picks where the request is processed. Set a region such
# as "asia-southeast1" (or "us" / "eu") if the sample values in a mapping
# request must stay in one place.
MAPPING_VERTEX_LOCATION = os.environ.get("MAPPING_VERTEX_LOCATION") or "global"

# ---- Gemini (Vertex AI) -----------------------------------------------------

# `or`, not a get() default, for the same reason as the mapping settings above.
GEMINI_ASSISTANT_MODEL = os.environ.get("GEMINI_ASSISTANT_MODEL") or "gemini-3.8-flash"
GCP_VERTEX_LOCATION = os.environ.get("GCP_VERTEX_LOCATION") or "global"

# ---- Authentication ---------------------------------------------------------

AUTH_ENABLED = os.environ.get("AUTH_ENABLED") or "false"
AUTH_SESSION_SECRET = os.environ.get("AUTH_SESSION_SECRET")
AUTH_ALLOWED_DOMAIN = os.environ.get("AUTH_ALLOWED_DOMAIN") or "shop-aire.com"
AUTH_FRONTEND_URL = os.environ.get("AUTH_FRONTEND_URL") or "http://localhost:3000"
AUTH_COOKIE_SECURE = os.environ.get("AUTH_COOKIE_SECURE") or "false"
AUTH_COOKIE_DOMAIN = os.environ.get("AUTH_COOKIE_DOMAIN")
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
GOOGLE_OAUTH_REDIRECT_URI = (
    os.environ.get("GOOGLE_OAUTH_REDIRECT_URI")
    or "http://localhost:8000/api/auth/callback"
)


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def auth_enabled() -> bool:
    """Return whether routes require a signed-in Workspace user."""
    return _enabled(AUTH_ENABLED)


def auth_cookie_secure() -> bool:
    """Return whether authentication cookies require HTTPS."""
    return _enabled(AUTH_COOKIE_SECURE)

# ---- Notifications ----------------------------------------------------------

# Notifications older than 60 days are deleted by the database itself (pg_cron,
# migrations/005_schedule_notification_cleanup.sql), not by this app.

# Pub/Sub subscription the scheduled BigQuery forecast run ("Retrain when new
# month lands") reports each finished run to. Empty: the backend does not
# listen, and only scripts/refresh_forecast.py raises forecast notifications.
FORECAST_PIPELINE_SUBSCRIPTION = os.environ.get("FORECAST_PIPELINE_SUBSCRIPTION", "")
# Written by retrain_if_new_month: one row per run, retrained=TRUE only when a
# new forecast was actually produced.
BQ_TRAINING_RUN_LOG_TABLE = (
    os.environ.get("BQ_TRAINING_RUN_LOG_TABLE")
    or "aire-data.Aire_Data_Analytics.training_run_log"
)
# The live forecast output (not the 12-hourly snapshot), so a notification
# raised right after a run describes that run.
BQ_FORECAST_PIPELINE_VIEW = (
    os.environ.get("BQ_FORECAST_PIPELINE_VIEW")
    or "aire-data.Aire_Data_Analytics.aire_forecasting_output"
)


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
            f"Copy .env.example to .env.backend and fill it in."
        )

    raise ConfigError(f"{name} is not set in {ENV_PATH}")


def require_file(name: str) -> str:
    """Like `require`, but also checks the path actually exists on disk."""
    path = require(name)
    if not os.path.exists(path):
        raise ConfigError(f"{name} points to a file that does not exist: {path}")
    return path


def optional_key_file(name: str) -> str | None:
    """
    Return a service-account key path, or None to use the runtime identity.

    None means Application Default Credentials: the service's own service
    account on Cloud Run, `gcloud auth application-default login` locally. A
    path that is set but missing is still an error, so a typo in .env.backend
    fails loudly instead of quietly switching to a different identity.
    """
    path = globals().get(name)
    if not path:
        return None
    if not os.path.exists(path):
        raise ConfigError(f"{name} points to a file that does not exist: {path}")
    return path
