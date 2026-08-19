from typing import List

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.services import storage

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

@router.post("")
async def upload_files(files: List[UploadFile] = File(...)):
    """
    Accept one or many files and upload them all.
 
    Returns HTTP 200 with a per-file result list even when some files fail, so a
    single bad file doesn't discard the successful ones. Check the "failed"
    count in the response rather than relying on the status code alone.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files were sent.")
 
    payload: list[tuple[str, bytes]] = [
        (f.filename or "unnamed", await f.read()) for f in files
    ]
    return storage.upload_many(payload)
