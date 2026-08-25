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

ORIGINAL_FILENAME_METADATA_KEY = "original_filename"

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

# Duplicate detection

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


# Upload single file

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

    # Timestamped destination so replacements keep a record of when the current version was uploaded
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
        "replaced": bool(existing and force),
    }
 
 
# Upload one or many files
 
def upload_many(files: list[tuple[str, bytes]], force: bool = False) -> dict:
    """
    Upload a batch of (filename, bytes) pairs. Works for one file or many.

    One bad file does not abort the rest. Each file gets its own result entry,
    so the caller can report partial success. Files that duplicate a
    previous upload are skipped (not uploaded) unless `force` is set.
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