from typing import List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from app.services import storage

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

MAX_FILES_PER_REQUEST = 10


@router.post("")
async def upload_files(
    files: List[UploadFile] = File(...),
    force: bool = Form(False),
):
    """
    Accept 1 to 10 files and upload them all.

    Files that duplicate a previously uploaded filename are skipped (with a
    "duplicate" result) unless `force` is set, in which case the previous
    upload for that filename is replaced.

    Returns HTTP 200 with a per-file result list even when some files fail, so a
    single bad file doesn't discard the successful ones. Check the "failed"
    count in the response rather than relying on the status code alone.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files were sent.")

    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Upload between 1 and {MAX_FILES_PER_REQUEST} files per request.",
        )

    payload: list[tuple[str, bytes]] = [
        (f.filename or "unnamed", await f.read()) for f in files
    ]

    return storage.upload_many(payload, force=force)
