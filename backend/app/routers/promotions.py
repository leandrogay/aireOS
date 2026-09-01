from fastapi import APIRouter, HTTPException
from app.services import sql
import sqlalchemy

router = APIRouter(prefix="/api/promotions", tags=["promotions"])

@router.get("/health/db")
async def check_db_connection():
    """
    Verifies the app can reach and authenticate against the Cloud SQL
    instance. Works even if the database has no tables/data yet -
    it just runs SELECT 1.
    """
    try:
        engine = sql.connect_with_connector()
        with engine.connect() as conn:
            result = conn.execute(sqlalchemy.text("SELECT 1")).scalar()
        return {"status": "ok", "db_reachable": True, "result": result}
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Database connection failed: {type(e).__name__}: {e}",
        )
 
 
@router.post("")
async def create_promotion():
    pass
