from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from google.api_core.exceptions import GoogleAPICallError
from google.genai import errors as genai_errors

from app.services import assistant, bigquery

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class AskRequest(BaseModel):
    question: str
    history: list[dict] = []
    customer: str = bigquery.DEFAULT_CUSTOMER
    last_chart: dict = {}
    last_chart_style: dict = {}


class ExportRequest(BaseModel):
    """
    The always-available PDF/PowerPoint button under any chart/table answer --
    unlike /ask, this is stateless and never touches the model: the
    frontend already has this exact data from the last ask() response, so
    it's just posted straight to the file builders.
    """
    format: str
    answer: str
    has_chart: bool = False
    chart_type: str = "none"
    chart_categories: list = []
    chart_series: list = []
    has_table: bool = False
    table_columns: list = []
    table_rows: list = []
    chart_style: dict = {}
    chart_trend_values: list = []


@router.post("/ask")
def ask(payload: AskRequest):
    try:
        return assistant.ask(
            question=payload.question,
            history=payload.history,
            customer=payload.customer,
            last_chart=payload.last_chart,
            last_chart_style=payload.last_chart_style,
        )
    except assistant.AssistantConfigError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except assistant.AssistantLoopError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except GoogleAPICallError as e:
        raise HTTPException(status_code=503, detail=f"Unable to reach BigQuery: {e.message}")
    except genai_errors.ClientError as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e.message}")
    except genai_errors.ServerError as e:
        raise HTTPException(status_code=503, detail=f"AI service is unavailable right now: {e.message}")
    except genai_errors.APIError as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e.message}")


@router.post("/export")
def export(payload: ExportRequest):
    if payload.format not in ("pdf", "pptx"):
        raise HTTPException(status_code=400, detail="format must be 'pdf' or 'pptx'")

    chart = {
        "has_chart": payload.has_chart,
        "chart_type": payload.chart_type,
        "chart_categories": payload.chart_categories,
        "chart_series": payload.chart_series,
        "has_table": payload.has_table,
        "table_columns": payload.table_columns,
        "table_rows": payload.table_rows,
    }
    try:
        file_bytes, media_type, filename = assistant.generate_export_file(
            payload.format, payload.answer, chart, payload.chart_style, payload.chart_trend_values
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not generate the file: {e}")

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
