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
ENV_PATH = Path(__file__).resolve().parents[2] / ".env.backend"
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


ORIGINAL_FILENAME_METADATA_KEY = "original_filename"


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


# ---- Duplicate detection -----------------------------------------------------

def find_existing_upload(client: storage.Client, safe_name: str):
    """
    Look for a previously uploaded blob with the same original filename.

    Matches on the `original_filename` custom metadata tag rather than the
    blob path, since every upload gets a timestamped destination path.
    """
    for blob in client.list_blobs(BUCKET_NAME, prefix=DESTINATION_PREFIX):
        if (blob.metadata or {}).get(ORIGINAL_FILENAME_METADATA_KEY) == safe_name:
            return blob
    return None


# ---- Upload: single file ----------------------------------------------------

def upload_file_bytes(filename: str, data: bytes, force: bool = False) -> dict:
    """
    Validate and upload a single file's bytes to the bucket.

    If a file with the same original filename was already uploaded and
    `force` is not set, no upload happens and a "duplicate" result is
    returned instead so the caller can warn and ask for confirmation.
    Passing `force=True` deletes the previous blob for that filename and
    replaces it, so sales data isn't double-counted.

    Returns a summary dict on success or duplicate. Raises:
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
    safe_name = Path(filename).name  # strip any path components

    existing = find_existing_upload(client, safe_name)
    if existing and not force:
        return {
            "success": False,
            "filename": safe_name,
            "reason": "duplicate",
            "duplicate": True,
            "existing_destination": f"gs://{BUCKET_NAME}/{existing.name}",
            "existing_uploaded_at": existing.time_created.isoformat() if existing.time_created else None,
            "error": f"'{safe_name}' was already uploaded. Confirm to replace it.",
        }

    # Timestamped destination so replacements keep a record of when the
    # current version was uploaded:
    #   uploads/2026-08-19_143012_fairprice_sellout.xlsx
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    destination = f"{DESTINATION_PREFIX}{timestamp}_{safe_name}"

    try:
        bucket = client.bucket(BUCKET_NAME)

        blob = bucket.blob(destination)
        blob.metadata = {ORIGINAL_FILENAME_METADATA_KEY: safe_name}
        blob.upload_from_string(
            data,
            content_type=CONTENT_TYPES.get(ext, "application/octet-stream"),
        )

        # Delete the old blob only after the new one is confirmed uploaded,
        # so a failed upload never leaves zero copies of the file.
        if existing and force:
            try:
                existing.delete()
            except gcloud_exceptions.NotFound:
                pass
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
        "replaced": bool(existing and force),
    }


# ---- Upload: one or many ----------------------------------------------------

def upload_many(files: list[tuple[str, bytes]], force: bool = False) -> dict:
    """
    Upload a batch of (filename, bytes) pairs. Works for one file or many.

    One bad file does not abort the rest — each file gets its own result entry,
    so the caller can report partial success. Results are returned in the same
    order as the input list, which the router relies on when pairing each
    result back to its bytes. Files that duplicate a previous upload are
    skipped (not uploaded) unless `force` is set.
    """
    results = []

    for filename, data in files:
        try:
            results.append(upload_file_bytes(filename, data, force=force))
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
    duplicates = sum(1 for r in results if r.get("reason") == "duplicate")
    return {
        "success": bool(results) and uploaded == len(results),
        "uploaded": uploaded,
        "duplicates": duplicates,
        "failed": len(results) - uploaded - duplicates,
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
