import io
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.ingest import process_excel_file

router = APIRouter()


@router.post("/api/ingest")
async def ingest_sales_file(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        result = process_excel_file(file_contents=contents, filename=file.filename)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to process file: {str(e)}")

    return result