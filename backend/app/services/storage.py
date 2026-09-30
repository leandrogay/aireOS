import json
import hashlib
import datetime
from pathlib import Path
from typing import Any
from functools import lru_cache
from google.cloud import storage
from google.oauth2 import service_account
from google.api_core import exceptions as gcloud_exceptions
from app import config

PROJECT_ID = config.GCP_PROJECT_ID
BUCKET_NAME = config.GCS_BUCKET_NAME
DESTINATION_PREFIX = config.GCS_DESTINATION_PREFIX
MAPPING_PREFIX = config.GCS_DESTINATION_PREFIX_MAPPING

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

# The SHA-256 of the uploaded bytes, so the same data re-sent under a new name
# is still recognised as already held. Filenames are a convention, not an
# identity -- "sales_aug.csv" and "sales_aug (1).csv" are routinely the same
# export -- and double-counting sales is the expensive mistake here.
CONTENT_HASH_METADATA_KEY = "content_hash"

# Written back onto the blob once the router has resolved a mapping for it, so
# the upload history can name the mapping without re-reading every file.
MAPPING_FINGERPRINT_METADATA_KEY = "mapping_fingerprint"
MAPPING_STATUS_METADATA_KEY = "mapping_status"
MAPPING_NAME_METADATA_KEY = "mapping_name"
VENDOR_METADATA_KEY = "vendor"


@lru_cache(maxsize=1)
def get_storage_client() -> storage.Client:
    """
    Build the GCS client once and reuse it.

    Each mapping lookup now costs several GCS round trips, so rebuilding the
    client (and re-reading the key file) on every call is wasted work. The
    client is safe to share across threads.
    """
    try:
        key_path = config.require_file("SERVICE_ACCOUNT_KEY_PATH")
        project_id = config.require("GCP_PROJECT_ID")
    except config.ConfigError as e:
        raise GCSConfigError(str(e)) from e

    credentials = service_account.Credentials.from_service_account_file(key_path)
    return storage.Client(project=project_id, credentials=credentials)


# ---- Duplicate detection -----------------------------------------------------

def content_digest(data: bytes) -> str:
    """SHA-256 of an upload's bytes -- the identity a filename only approximates."""
    return hashlib.sha256(data).hexdigest()


def find_existing_upload(
    client: storage.Client, safe_name: str, digest: str | None = None
) -> tuple[Any, str | None]:
    """
    Look for a previously uploaded blob that duplicates this one.

    Two matches count, in priority order, and the caller is told which fired:

      "content"   the same bytes are already in the bucket, whatever they were
                  named. This wins, because it is the one that double-counts
                  sales, and it is certain -- a SHA-256 collision is not a
                  practical concern.
      "filename"  the same original filename was uploaded before. Weaker: it
                  catches a re-export of the same period under the same name,
                  but also fires on a genuinely corrected file, which is why
                  `force` exists.

    Both match on custom metadata rather than the blob path, since every upload
    gets a timestamped destination. One listing pass serves both checks.

    Blobs written before content hashing simply have no hash metadata; they
    still match by filename, and never spuriously by content.
    """
    filename_match = None

    for blob in client.list_blobs(BUCKET_NAME, prefix=DESTINATION_PREFIX):
        metadata = blob.metadata or {}

        if digest and metadata.get(CONTENT_HASH_METADATA_KEY) == digest:
            return blob, "content"

        if filename_match is None and metadata.get(ORIGINAL_FILENAME_METADATA_KEY) == safe_name:
            filename_match = blob

    return (filename_match, "filename") if filename_match else (None, None)


# ---- Upload: single file ----------------------------------------------------

def upload_file_bytes(
    filename: str, data: bytes, force: bool = False, keep_duplicate: bool = False
) -> dict:
    """
    Validate and upload a single file's bytes to the bucket.

    If the same bytes, or the same original filename, were already uploaded
    and `force` is not set, no upload happens and a "duplicate" result is
    returned instead so the caller can warn and ask for confirmation. The
    result's `duplicate_of` says which check fired -- see find_existing_upload.

    Two ways past that, and they are not the same thing:
      force=True           replaces the previous blob. The old file was wrong
                           or superseded; only the new one should count.
      keep_duplicate=True  keeps both. The reviewer has decided the match is a
                           false positive -- two stores' identical exports,
                           say -- so both belong in the bucket.

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
    digest = content_digest(data)

    existing, match_kind = find_existing_upload(client, safe_name, digest)
    if existing and not force and not keep_duplicate:
        existing_name = (existing.metadata or {}).get(
            ORIGINAL_FILENAME_METADATA_KEY, safe_name
        )
        error = (
            f"The same file contents were already uploaded as '{existing_name}'."
            if match_kind == "content"
            else f"'{safe_name}' was already uploaded. Confirm to replace it."
        )
        return {
            "success": False,
            "filename": safe_name,
            "reason": "duplicate",
            "duplicate": True,
            "duplicate_of": match_kind,
            "existing_filename": existing_name,
            "existing_destination": f"gs://{BUCKET_NAME}/{existing.name}",
            "existing_uploaded_at": existing.time_created.isoformat() if existing.time_created else None,
            "error": error,
        }

    # Timestamped destination so replacements keep a record of when the
    # current version was uploaded:
    #   uploads/2026-08-19_143012_fairprice_sellout.xlsx
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    destination = f"{DESTINATION_PREFIX}{timestamp}_{safe_name}"

    try:
        bucket = client.bucket(BUCKET_NAME)

        blob = bucket.blob(destination)
        blob.metadata = {
            ORIGINAL_FILENAME_METADATA_KEY: safe_name,
            CONTENT_HASH_METADATA_KEY: digest,
        }
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
        "content_hash": digest,
        "destination": f"gs://{BUCKET_NAME}/{destination}",
        "blob_path": destination,
        "replaced": bool(existing and force),
    }


# ---- Upload: one or many ----------------------------------------------------

def upload_many(
    files: list[tuple[str, bytes]], force: bool = False, keep_duplicate: bool = False
) -> dict:
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
            results.append(
                upload_file_bytes(
                    filename, data, force=force, keep_duplicate=keep_duplicate
                )
            )
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


# ---- Upload history ----------------------------------------------------------

def update_uploads_for_mapping(
    fingerprint: str, annotations: dict[str, str]
) -> dict[str, list[str]]:
    """
    Re-stamp every upload that went through one mapping.

    An upload records the mapping it resolved to and the state that mapping was
    in at the time. When a proposal is approved, that recorded state becomes
    wrong for every file already uploaded against it -- the history would keep
    showing "Needs review" for files whose mapping is now confirmed. This walks
    the uploads and corrects them.

    Returns `matched` (every upload that used this mapping) alongside `updated`
    (the ones whose metadata was actually rewritten). They differ when a patch
    fails, and the caller wants both: `matched` is the set of files now ready
    to be transformed, while `updated` is what the history will show. Best
    effort per blob, in keeping with annotate_upload -- a stale history label
    is not a reason to fail the approval that prompted it.
    """
    try:
        blobs = list(get_storage_client().list_blobs(BUCKET_NAME, prefix=DESTINATION_PREFIX))
    except gcloud_exceptions.NotFound:
        return {"matched": [], "updated": []}
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(f"List denied on {DESTINATION_PREFIX}. Details: {e}")
    except Exception as e:
        raise GCSUploadError(f"Failed listing {DESTINATION_PREFIX}: {e}")

    matched: list[str] = []
    updated: list[str] = []

    for blob in blobs:
        if (blob.metadata or {}).get(MAPPING_FINGERPRINT_METADATA_KEY) != fingerprint:
            continue
        matched.append(blob.name)
        if annotate_upload(blob.name, annotations):
            updated.append(blob.name)

    return {"matched": matched, "updated": updated}


def move_pending_mapping_to_confirmed(fingerprint: str, envelope: dict) -> dict:
    """
    Promote a proposal: write it under mappings/confirmed/, then remove the
    mappings/pending/ copy.

    Written in that order on purpose. The two blobs are separate objects with
    no transaction between them, so one of the two orders loses the contract
    if the process dies in the middle and the other leaves a duplicate. A
    duplicate is harmless -- every lookup checks confirmed/ first -- so the
    write comes first and the delete is allowed to fail.

    Returns where it went, and whether the pending copy is actually gone.
    """
    confirmed_path = confirmed_mapping_path(fingerprint)
    pending_path = pending_mapping_path(fingerprint)

    stored_at = upload_json(confirmed_path, envelope)

    try:
        removed_pending = delete_blob(pending_path)
        pending_error = None
    except (GCSPermissionError, GCSUploadError) as exc:
        removed_pending = False
        pending_error = str(exc)

    return {
        "stored_at": stored_at,
        "confirmed_path": confirmed_path,
        "pending_path": pending_path,
        "removed_pending": removed_pending,
        "pending_error": pending_error,
    }


def annotate_upload(blob_path: str, annotations: dict[str, str]) -> bool:
    """
    Merge extra metadata onto an already-uploaded blob.

    The router calls this once a mapping has been resolved, so the history
    listing can report which mapping a file went through without re-reading
    and re-fingerprinting every file in the bucket. Best effort: a file that
    uploaded fine but could not be annotated is still a successful upload, so
    this returns False rather than raising.
    """
    try:
        blob = get_storage_client().bucket(BUCKET_NAME).blob(blob_path)
        if not blob.exists():
            return False
        blob.metadata = {**(blob.metadata or {}), **annotations}
        blob.patch()
        return True
    except Exception:
        return False


def list_uploads(limit: int = 50) -> list[dict]:
    """
    Recent uploads, newest first.

    The bucket is the record of what has been uploaded -- there is no upload
    table -- so this reads the blob listing and its custom metadata. Sorting
    happens here rather than in the listing call because GCS returns blobs in
    lexicographic name order, which the timestamp prefix makes chronological
    only by accident of formatting.
    """
    try:
        blobs = list(get_storage_client().list_blobs(BUCKET_NAME, prefix=DESTINATION_PREFIX))
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(f"List denied on {DESTINATION_PREFIX}. Details: {e}")
    except gcloud_exceptions.NotFound:
        return []
    except Exception as e:
        raise GCSUploadError(f"Failed listing {DESTINATION_PREFIX}: {e}")

    blobs.sort(key=lambda blob: blob.time_created or datetime.datetime.min, reverse=True)

    uploads = []
    for blob in blobs[:limit]:
        metadata = blob.metadata or {}
        uploads.append({
            "filename": metadata.get(ORIGINAL_FILENAME_METADATA_KEY)
            or blob.name[len(DESTINATION_PREFIX):],
            "blob_path": blob.name,
            "destination": f"gs://{BUCKET_NAME}/{blob.name}",
            "uploaded_at": blob.time_created.isoformat() if blob.time_created else None,
            "size_bytes": blob.size,
            "content_hash": metadata.get(CONTENT_HASH_METADATA_KEY),
            "mapping_fingerprint": metadata.get(MAPPING_FINGERPRINT_METADATA_KEY),
            "mapping_status": metadata.get(MAPPING_STATUS_METADATA_KEY),
            "mapping_name": metadata.get(MAPPING_NAME_METADATA_KEY),
            "vendor": metadata.get(VENDOR_METADATA_KEY),
        })

    return uploads


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


def blob_path_from_uri(uri: str) -> str:
    """
    Turn a stored `gs://bucket/uploads/…` URI back into a blob path.

    Mapping envelopes record where their example file landed as a full URI.
    A path that is already relative is returned unchanged, so callers do not
    have to know which form they were handed.
    """
    prefix = f"gs://{BUCKET_NAME}/"
    return uri[len(prefix):] if uri.startswith(prefix) else uri.lstrip("/")


def download_bytes(path: str) -> bytes | None:
    """Read a blob's raw bytes. Returns None if the blob is absent."""
    try:
        blob = _blob(path)
        if not blob.exists():
            return None
        return blob.download_as_bytes()
    except gcloud_exceptions.Forbidden as e:
        raise GCSPermissionError(f"Read denied on {path}. Details: {e}")
    except Exception as e:
        raise GCSUploadError(f"Failed reading {path}: {e}")


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
