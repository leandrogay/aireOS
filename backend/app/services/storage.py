import os
import datetime
from dotenv import load_dotenv
from pathlib import Path

from google.cloud import storage
from google.oauth2 import service_account
from google.api_core import exceptions as gcloud_exceptions

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env.local")
load_dotenv(BASE_DIR / "venv" / ".env.local")

SERVICE_ACCOUNT_KEY_PATH = os.environ.get("SERVICE_ACCOUNT_KEY_PATH")
PROJECT_ID = os.environ.get("GCP_PROJECT_ID","PASTE_YOUR_GCP_PROJECT_ID_HERE")
BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME","PASTE_YOUR_BUCKET_NAME_HERE")
DESTINATION_PREFIX = os.environ.get("GCS_DESTINATION_PREFIX", "uploads/")

ALLOWED_EXTENSIONS = {".xlsx", ".csv", ".txt"}
CONTENT_TYPES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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


def get_storage_client() -> storage.Client:
    if not SERVICE_ACCOUNT_KEY_PATH:
        raise GCSConfigError("SERVICE_ACCOUNT_KEY_PATH is not set or missing")

    key_path = Path(SERVICE_ACCOUNT_KEY_PATH).expanduser()
    if not key_path.is_absolute():
        key_path = (BASE_DIR / key_path).resolve()

    if not key_path.exists():
        raise GCSConfigError(f"Service account key file not found at: {key_path}")

    if key_path.stat().st_size == 0:
        raise GCSConfigError(f"Service account key file is empty at: {key_path}")
    
    credentials = service_account.Credentials.from_service_account_file(str(key_path))
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
    }
 
 
# ---- Upload: one or many ----------------------------------------------------
 
def upload_many(files: list[tuple[str, bytes]]) -> dict:
    """
    Upload a batch of (filename, bytes) pairs. Works for one file or many.
 
    One bad file does not abort the rest — each file gets its own result entry,
    so the caller can report partial success.
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