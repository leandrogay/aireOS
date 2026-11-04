"""Debounce SQL changes, wait for CDC, and run Sandra's existing forecast procedure."""

import hashlib
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from google.api_core.exceptions import Conflict, NotFound
from google.cloud import bigquery
from sqlalchemy import text

from app.services import forecast_pipeline_events, forecast_refresh_events, notification_service, sql
from app.services.bigquery import get_bigquery_client

DATASET = "aire-data.aireos_cdc_sg"
PROCEDURE = "aire-data.Aire_Data_Analytics.retrain_if_new_month"
RUN_LOG = "aire-data.Aire_Data_Analytics.training_run_log"
JOB_LOCATION = "asia-southeast1"
LOCK_ID = 528047149
SALES_COLUMNS = (
    "retailer_id", "store_code", "sku", "period_start", "period_end",
    "period_type", "quantity_units", "revenue", "source_file", "loaded_at",
)
PROMOTION_COLUMNS = (
    "promotion_id", "period_start", "period_end", "period_label",
    "promo_type", "promotion_mechanic", "voucher", "updated_at",
)


def _stamp(value) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="microseconds")
    if isinstance(value, float):
        return str(Decimal(str(value)).quantize(Decimal("0.000001")))
    if isinstance(value, Decimal):
        return str(value.quantize(Decimal("0.000001")))
    return str(value) if value is not None else "<NULL>"


def _signature(rows, columns: tuple[str, ...]) -> list[tuple[str, ...]]:
    return sorted(tuple(_stamp(row[column]) for column in columns) for row in rows)


def _query_bigquery(query: str, parameters: list) -> list[dict]:
    job_config = bigquery.QueryJobConfig(query_parameters=parameters)
    return [dict(row) for row in get_bigquery_client().query(
        query, job_config=job_config, location=JOB_LOCATION
    ).result()]


def _cdc_has_requests(ids: list[int]) -> bool:
    try:
        rows = _query_bigquery(
            f"SELECT id FROM `{DATASET}.public_forecast_refresh_requests` WHERE id IN UNNEST(@ids)",
            [bigquery.ArrayQueryParameter("ids", "INT64", ids)],
        )
    except NotFound:
        return False
    return {row["id"] for row in rows} == set(ids)


def _sales_landed(conn, filenames: list[str]) -> bool:
    if not filenames:
        return True
    local = conn.execute(text(f"""
        SELECT {', '.join(SALES_COLUMNS)} FROM sellout
        WHERE source_file = ANY(CAST(:files AS text[]))
    """), {"files": filenames}).mappings().all()
    copied = _query_bigquery(
        f"SELECT {', '.join(SALES_COLUMNS)} FROM `{DATASET}.public_sellout` "
        "WHERE source_file IN UNNEST(@files)",
        [bigquery.ArrayQueryParameter("files", "STRING", filenames)],
    )
    return _signature(local, SALES_COLUMNS) == _signature(copied, SALES_COLUMNS)


def _promotions_landed(conn, promotion_ids: list[int]) -> bool:
    if not promotion_ids:
        return True
    parameters = [bigquery.ArrayQueryParameter("ids", "INT64", promotion_ids)]
    local_promotions = conn.execute(text(f"""
        SELECT {', '.join(PROMOTION_COLUMNS)} FROM promotions
        WHERE promotion_id = ANY(CAST(:ids AS integer[]))
    """), {"ids": promotion_ids}).mappings().all()
    copied_promotions = _query_bigquery(
        f"SELECT {', '.join(PROMOTION_COLUMNS)} FROM `{DATASET}.public_promotions` "
        "WHERE promotion_id IN UNNEST(@ids)", parameters,
    )
    if _signature(local_promotions, PROMOTION_COLUMNS) != _signature(copied_promotions, PROMOTION_COLUMNS):
        return False
    for table, column in (("promotion_stores", "store_id"), ("promotion_skus", "sku")):
        columns = ("promotion_id", column)
        local = conn.execute(text(f"""
            SELECT promotion_id, {column} FROM {table}
            WHERE promotion_id = ANY(CAST(:ids AS integer[]))
        """), {"ids": promotion_ids}).mappings().all()
        copied = _query_bigquery(
            f"SELECT promotion_id, {column} FROM `{DATASET}.public_{table}` "
            "WHERE promotion_id IN UNNEST(@ids)", parameters,
        )
        if _signature(local, columns) != _signature(copied, columns):
            return False
    return True


def _inputs_landed(conn, requests: list[dict]) -> bool:
    ids = [row["id"] for row in requests]
    if not _cdc_has_requests(ids):
        return False
    sales = sorted({row["source"][6:] for row in requests if row["source"].startswith("sales:")})
    promotions = sorted({int(row["source"][10:]) for row in requests if row["source"].startswith("promotion:")})
    if len(sales) + len(promotions) < len({row["source"] for row in requests}):
        raise ValueError("Unknown forecast refresh source")
    return _sales_landed(conn, sales) and _promotions_landed(conn, promotions)


def _retry_later() -> dict:
    minute = int((time.time() + 60) // 60)
    forecast_refresh_events.enqueue_check(key=f"forecast-poll-{minute}", delay_seconds=60)
    return {"status": "waiting"}


def _pending(conn) -> list[dict]:
    return [dict(row) for row in conn.execute(text("""
        SELECT id, kind, source, created_at, job_id FROM forecast_refresh_requests
        WHERE status = 'pending' ORDER BY id
    """)).mappings()]


def _running(conn) -> str | None:
    jobs = {row[0] for row in conn.execute(text("""
        SELECT DISTINCT job_id FROM forecast_refresh_requests WHERE status = 'running'
    """))}
    if len(jobs) > 1:
        raise RuntimeError("More than one forecast refresh batch is marked running")
    return next(iter(jobs), None)


def _job_id(ids: list[int], previous_job_id: str | None = None) -> str:
    digest = hashlib.sha256(",".join(map(str, ids)).encode()).hexdigest()[:24]
    base = f"aireos_forecast_event_{digest}"
    if not previous_job_id:
        return base
    if previous_job_id == base:
        return f"{base}_retry1"
    prefix = f"{base}_retry"
    if previous_job_id.startswith(prefix) and previous_job_id[len(prefix):].isdigit():
        return f"{prefix}{int(previous_job_id[len(prefix):]) + 1}"
    # New requests may have joined the pending batch since the skipped run.
    return base


def _claim(ids: list[int], job_id: str) -> bool:
    with sql.connect_with_connector().begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": LOCK_ID})
        if _running(conn):
            return False
        result = conn.execute(text("""
            UPDATE forecast_refresh_requests SET status = 'running', job_id = :job_id,
                dispatched_at = CURRENT_TIMESTAMP
            WHERE id = ANY(CAST(:ids AS bigint[])) AND status = 'pending'
        """), {"ids": ids, "job_id": job_id})
        if result.rowcount != len(ids):
            raise RuntimeError("Forecast refresh requests changed while claiming the batch")
    return True


def _ensure_job(job_id: str):
    client = get_bigquery_client()
    try:
        return client.get_job(job_id, location=JOB_LOCATION)
    except NotFound:
        try:
            return client.query(
                f"CALL `{PROCEDURE}`(TRUE)", job_id=job_id, location=JOB_LOCATION
            )
        except Conflict:
            return client.get_job(job_id, location=JOB_LOCATION)


def _run_outcome(job) -> tuple[bool, bool]:
    if not job.started or not job.ended:
        return False, False
    rows = _query_bigquery(
        f"SELECT COUNT(*) AS checked, COUNTIF(retrained) AS retrained FROM `{RUN_LOG}` "
        "WHERE checked_at BETWEEN @started AND @ended",
        [
            bigquery.ScalarQueryParameter("started", "TIMESTAMP", job.started),
            bigquery.ScalarQueryParameter("ended", "TIMESTAMP", job.ended),
        ],
    )
    return bool(rows and rows[0]["checked"]), bool(rows and rows[0]["retrained"])


def _finish(job_id: str, job) -> dict:
    failed = bool(job.error_result)
    checked, retrained = _run_outcome(job) if not failed else (False, False)
    if not failed and not checked:
        # The routine returns without logging when another forecast is busy.
        # Keep the outbox pending and use a new BigQuery job ID on the next try.
        with sql.connect_with_connector().begin() as conn:
            conn.execute(text("""
                UPDATE forecast_refresh_requests
                SET status = 'pending', dispatched_at = NULL
                WHERE job_id = :job_id AND status = 'running'
            """), {"job_id": job_id})
        return _retry_later()
    if failed or retrained:
        if not notification_service.has_forecast_run(job_id):
            payload = {
                **({"period_start": None, "period_end": None, "customers": [], "skus": []}
                   if failed else forecast_pipeline_events._latest_forecast_summary()),
                "updated_at": (job.ended or datetime.now(timezone.utc)).isoformat(),
                "errors": [str(job.error_result)] if failed else [],
                "source": "event",
                "run_name": job_id,
            }
            notification_service.insert(
                notification_service.FORECAST_FAILURE if failed else notification_service.FORECAST_SUCCESS,
                payload,
            )
    with sql.connect_with_connector().begin() as conn:
        conn.execute(text("""
            UPDATE forecast_refresh_requests
            SET status = :status, finished_at = CURRENT_TIMESTAMP, last_error = :error
            WHERE job_id = :job_id AND status = 'running'
        """), {
            "status": "failed" if failed else "completed",
            "error": str(job.error_result) if failed else None,
            "job_id": job_id,
        })
        pending = _pending(conn)
    if pending:
        forecast_refresh_events.enqueue_check(
            key=f"forecast-after-{pending[-1]['id']}", delay_seconds=60
        )
    return {"status": "failed" if failed else "completed", "job_id": job_id}


def check_refresh() -> dict:
    """Process one batch check; Cloud Tasks retries are safe by SQL status and job ID."""
    engine = sql.connect_with_connector_autocommit()
    with engine.connect() as conn:
        running = _running(conn)
        if running:
            job = _ensure_job(running)
            return _finish(running, job) if job.done() else _retry_later()
        pending = _pending(conn)
        if not pending:
            return {"status": "idle"}
        newest = max(row["created_at"] for row in pending)
        if newest > datetime.now(timezone.utc) - timedelta(seconds=forecast_refresh_events.QUIET_SECONDS):
            return _retry_later()
        if not _inputs_landed(conn, pending):
            return _retry_later()

    ids = [row["id"] for row in pending]
    previous_jobs = {row["job_id"] for row in pending if row.get("job_id")}
    job_id = _job_id(ids, next(iter(previous_jobs))) if len(previous_jobs) == 1 else _job_id(ids)
    if not _claim(ids, job_id):
        return _retry_later()
    job = _ensure_job(job_id)
    return _finish(job_id, job) if job.done() else _retry_later()
