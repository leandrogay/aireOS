import io
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.ingest import process_excel_file

router = APIRouter()


@router.get("/api/ingest")
async def ingest_sales_file():
    try:
        result = process_excel_file()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to process file: {str(e)}")

    return result