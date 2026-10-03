"""
What will happen to a file if it is uploaded, asked before it is.

The upload screen calls this the moment a file is dropped, so it can show
which files are ready, which need a decision (a duplicate) and which cannot be
uploaded at all, before anything is sent. Everything here is read-only: the
bucket is listed but never written, and a new layout is reported as new rather
than sent to Claude. The real upload (routers/uploads.upload_files) still runs
every check again, so nothing here has to be trusted.
"""

from pathlib import Path

from app.services import generate_mapping, storage

UNREADABLE_MESSAGE = "We couldn't read any columns. Check that it opens as a table in Excel."


def check_file(filename: str, data: bytes) -> dict:
    """
    One file's pre-upload answer: an `error` when it cannot be uploaded,
    otherwise the mapping it would get and the earlier upload it duplicates,
    if any. `content_hash` lets the screen spot two identical files in the
    same batch.
    """
    result = {
        "filename": Path(filename).name,
        "content_hash": storage.content_digest(data),
        "error": None,
        "mapping": None,
        "duplicate": None,
    }

    ext = Path(filename).suffix.lower()
    if ext not in storage.ALLOWED_EXTENSIONS:
        result["error"] = f"'{ext or '?'}' isn't a supported file type."
        return result

    try:
        result["mapping"] = generate_mapping.preview_mapping(filename, data)
    except generate_mapping.UnreadableSourceFileError:
        result["error"] = UNREADABLE_MESSAGE
        return result

    result["duplicate"] = storage.check_duplicate(filename, data)
    return result


def check_files(files: list[tuple[str, bytes]]) -> list[dict]:
    """check_file for each (filename, bytes) pair, in the order given."""
    return [check_file(filename, data) for filename, data in files]
