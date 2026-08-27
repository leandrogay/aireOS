import os
import json
import datetime
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv

from google.cloud import storage
from google.oauth2 import service_account
from google.api_core import exceptions as gcloud_exceptions

# Resolve .env.local from the project root rather than the current working
# directory, so the app behaves the same however it is launched.
ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"
load_dotenv(ENV_PATH)

SERVICE_ACCOUNT_KEY_PATH = os.environ.get("SERVICE_ACCOUNT_KEY_PATH")
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "PASTE_YOUR_GCP_PROJECT_ID_HERE")
BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "PASTE_YOUR_BUCKET_NAME_HERE")
DESTINATION_PREFIX = os.environ.get("GCS_DESTINATION_PREFIX", "uploads/")
MAPPING_PREFIX = os.environ.get("GCS_DESTINATION_PREFIX_MAPPING", "mappings/")

ALLOWED_EXTENSIONS = {".xlsx", ".xlsm", ".csv", ".txt"}
CONTENT_TYPES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".csv": "text/csv",
    ".txt": "text/plain",
}


class GCSConfigError(Exception):
    """Config is missing or the key file can't be found."""


class GCSPermissionError(Exception):
    """The service account lacks the required bucket permission."""


class GCSUploadError(Exception):
    """Any other failure while uploading."""


class InvalidFileTypeError(Exception):
    """The uploaded file has a disallowed extension."""


@lru_cache(maxsize=1)
def get_storage_client() -> storage.Client:
    """
    Build the GCS client once and reuse it.

    Each mapping lookup now costs several GCS round trips, so rebuilding the
    client (and re-reading the key file) on every call is wasted work. The
    client is safe to share across threads.
    """
    if not SERVICE_ACCOUNT_KEY_PATH:
        raise GCSConfigError("SERVICE_ACCOUNT_KEY_PATH is not set or missing")
    if not os.path.exists(SERVICE_ACCOUNT_KEY_PATH):
        raise GCSConfigError(
            f"Service account key file not found at: {SERVICE_ACCOUNT_KEY_PATH}"
        )

    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_KEY_PATH
    )
    return storage.Client(project=PROJECT_ID, credentials=credentials)


# ---- Upload: single file ----------------------------------------------------

def upload_file_bytes(filename: str, data: bytes) -> dict:
    """
    Validate and upload a single file's bytes to the bucket.

    Returns a summary dict on success. Raises:
        InvalidFileTypeError  - disallowed extension
        GCSConfigError        - setup problem
        GCSPermissionError    - service account lacks write access
        GCSUploadError        - any other upload failure
    """
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise InvalidFileTypeError(
            f"'{ext}' is not allowed. Accepted types: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    client = get_storage_client()  # may raise GCSConfigError

    # Timestamped destination so uploads don't overwrite each other:
    #   uploads/2026-08-19_143012_fairprice_sellout.xlsx
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    safe_name = Path(filename).name  # strip any path components
    destination = f"{DESTINATION_PREFIX}{timestamp}_{safe_name}"

    try:
        bucket = client.bucket(BUCKET_NAME)
        blob = bucket.blob(destination)
        blob.upload_from_string(
            data,
            content_type=CONTENT_TYPES.get(ext, "application/octet-stream"),
        )
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(
            f"Upload denied — the service account lacks write permission on the bucket. Details: {e}"
        )
    except Exception as e:
        raise GCSUploadError(f"Upload failed: {e}")

    return {
        "success": True,
        "filename": safe_name,
        "size_bytes": len(data),
        "destination": f"gs://{BUCKET_NAME}/{destination}",
        "blob_path": destination,
    }


# ---- Upload: one or many ----------------------------------------------------

def upload_many(files: list[tuple[str, bytes]]) -> dict:
    """
    Upload a batch of (filename, bytes) pairs. Works for one file or many.

    One bad file does not abort the rest — each file gets its own result entry,
    so the caller can report partial success. Results are returned in the same
    order as the input list, which the router relies on when pairing each
    result back to its bytes.
    """
    results = []

    for filename, data in files:
        try:
            results.append(upload_file_bytes(filename, data))
        except InvalidFileTypeError as e:
            results.append({
                "success": False,
                "filename": Path(filename).name,
                "error": str(e),
                "reason": "invalid_type",
            })
        except (GCSConfigError, GCSPermissionError, GCSUploadError) as e:
            results.append({
                "success": False,
                "filename": Path(filename).name,
                "error": str(e),
                "reason": "upload_failed",
            })

    uploaded = sum(1 for r in results if r["success"])
    return {
        "success": bool(results) and uploaded == len(results),
        "uploaded": uploaded,
        "failed": len(results) - uploaded,
        "results": results,
    }


# ---- Mapping contracts: JSON objects in the bucket --------------------------
#
# Pending and confirmed contracts live under separate sub-prefixes so that a
# plain listing of mappings/confirmed/ returns exactly the approved contracts
# with nothing to filter out.

def pending_mapping_path(fingerprint: str) -> str:
    return f"{MAPPING_PREFIX}pending/{fingerprint}.json"


def confirmed_mapping_path(fingerprint: str) -> str:
    return f"{MAPPING_PREFIX}confirmed/{fingerprint}.json"


def _blob(path: str):
    return get_storage_client().bucket(BUCKET_NAME).blob(path)


def upload_json(path: str, obj: dict) -> str:
    """Write a dict to the bucket as pretty-printed JSON. Returns the gs:// URI."""
    try:
        _blob(path).upload_from_string(
            json.dumps(obj, indent=2),
            content_type="application/json",
        )
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(f"Write denied on {path}. Details: {e}")
    except Exception as e:
        raise GCSUploadError(f"Failed writing {path}: {e}")

    return f"gs://{BUCKET_NAME}/{path}"


def download_json(path: str) -> dict | None:
    """Read a JSON object from the bucket. Returns None if the blob is absent."""
    try:
        blob = _blob(path)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_bytes())
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(f"Read denied on {path}. Details: {e}")
    except json.JSONDecodeError as e:
        raise GCSUploadError(f"Blob at {path} is not valid JSON: {e}")
    except Exception as e:
        raise GCSUploadError(f"Failed reading {path}: {e}")


def delete_blob(path: str) -> bool:
    """
    Delete a blob. Returns True if something was deleted, False if it was
    already gone. Used to clear a pending contract once it's been confirmed.
    """
    try:
        blob = _blob(path)
        if not blob.exists():
            return False
        blob.delete()
        return True
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(f"Delete denied on {path}. Details: {e}")
    except Exception as e:
        raise GCSUploadError(f"Failed deleting {path}: {e}")


def list_mapping_fingerprints(state: str) -> list[str]:
    """
    List the fingerprints stored under mappings/{state}/.

    state is "pending" or "confirmed". Returns an empty list rather than
    raising when the prefix has never been written to, since an app that has
    confirmed nothing yet is a normal state and not an error.
    """
    prefix = f"{MAPPING_PREFIX}{state}/"
    try:
        blobs = get_storage_client().list_blobs(BUCKET_NAME, prefix=prefix)
        return [
            blob.name[len(prefix):-len(".json")]
            for blob in blobs
            if blob.name.endswith(".json")
        ]
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(f"List denied on {prefix}. Details: {e}")
    except gcloud_exceptions.NotFound:
        return []
    except Exception as e:
        raise GCSUploadError(f"Failed listing {prefix}: {e}")
