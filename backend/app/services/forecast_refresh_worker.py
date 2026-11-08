"""Debounce SQL changes, wait for CDC, and run Sandra's existing forecast procedure."""

import hashlib
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from google.api_core.exceptions import Conflict, NotFound
from google.cloud import bigquery
from sqlalchemy import text

from app import config
from app.services import (
    catalog_service,
    forecast_notifications,
    forecast_refresh_events,
    inventory_service,
    notification_service,
    sell_in_snapshots,
    sql,
)
from app.services.bigquery import get_bigquery_client

logger = logging.getLogger("uvicorn.error")
# "Started by" in the bell: a save in the app (sales, promotion or SKU).
EVENT_SOURCE = "event"
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
        query, job_config=job_config, location=config.BQ_FORECAST_LOCATION
    ).result()]


def _cdc_has_requests(ids: list[int]) -> bool:
    try:
        rows = _query_bigquery(
            f"SELECT id FROM `{config.BQ_CDC_DATASET}.public_forecast_refresh_requests` WHERE id IN UNNEST(@ids)",
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
        f"SELECT {', '.join(SALES_COLUMNS)} FROM `{config.BQ_CDC_DATASET}.public_sellout` "
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
        f"SELECT {', '.join(PROMOTION_COLUMNS)} FROM `{config.BQ_CDC_DATASET}.public_promotions` "
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
            f"SELECT promotion_id, {column} FROM `{config.BQ_CDC_DATASET}.public_{table}` "
            "WHERE promotion_id IN UNNEST(@ids)", parameters,
        )
        if _signature(local, columns) != _signature(copied, columns):
            return False
    return True


def _skus_landed(conn, skus: list[str]) -> bool:
    if not skus:
        return True
    columns = ("sku", "is_active")
    local = conn.execute(text("""
        SELECT sku, is_active FROM skus WHERE sku = ANY(CAST(:skus AS text[]))
    """), {"skus": skus}).mappings().all()
    copied = _query_bigquery(
        f"SELECT sku, is_active FROM `{config.BQ_CDC_DATASET}.public_skus` "
        "WHERE sku IN UNNEST(@skus)",
        [bigquery.ArrayQueryParameter("skus", "STRING", skus)],
    )
    return _signature(local, columns) == _signature(copied, columns)


def _inputs_landed(conn, requests: list[dict]) -> bool:
    ids = [row["id"] for row in requests]
    if not _cdc_has_requests(ids):
        return False
    sales = sorted({row["source"][6:] for row in requests if row["source"].startswith("sales:")})
    promotions = sorted({int(row["source"][10:]) for row in requests if row["source"].startswith("promotion:")})
    skus = sorted({row["source"][4:] for row in requests if row["source"].startswith("sku:")})
    if len(sales) + len(promotions) + len(skus) < len({row["source"] for row in requests}):
        raise ValueError("Unknown forecast refresh source")
    return _sales_landed(conn, sales) and _promotions_landed(conn, promotions) and _skus_landed(conn, skus)


def _retry_later() -> dict:
    minute = int((time.time() + 60) // 60)
    forecast_refresh_events.enqueue_check(key=f"forecast-poll-{minute}", delay_seconds=60)
    return {"status": "waiting"}


def _max_wait() -> timedelta:
    match = re.fullmatch(r"(\d+)([smh])", config.FORECAST_REFRESH_MAX_WAIT.strip().lower())
    if not match or int(match[1]) <= 0:
        raise ValueError("FORECAST_REFRESH_MAX_WAIT must be a positive duration such as 2h")
    return timedelta(seconds=int(match[1]) * {"s": 1, "m": 60, "h": 3600}[match[2]])


def _max_wait_text() -> str:
    # "2 hours" for the default 2h, for the reason shown in the bell.
    seconds = int(_max_wait().total_seconds())
    for size, unit in ((3600, "hour"), (60, "minute"), (1, "second")):
        if seconds % size == 0:
            count = seconds // size
            return f"{count} {unit}" + ("" if count == 1 else "s")
    return f"{seconds} seconds"


def _waited_too_long(requests: list[dict]) -> bool:
    # Measured from the newest save in the batch, like the CDC wait in
    # check_refresh, so an old request never fails a fresh one.
    newest = max(row["created_at"] for row in requests)
    return newest <= datetime.now(timezone.utc) - _max_wait()


def _fail_pending(requests: list[dict], reason: str) -> dict:
    ids = [row["id"] for row in requests]
    with sql.connect_with_connector().begin() as conn:
        failed = conn.execute(text("""
            UPDATE forecast_refresh_requests
            SET status = 'failed', finished_at = CURRENT_TIMESTAMP, last_error = :reason
            WHERE id = ANY(CAST(:ids AS bigint[])) AND status = 'pending'
            RETURNING id
        """), {"ids": ids, "reason": reason}).scalars().all()
    if not failed:
        return {"status": "idle"}

    payload = forecast_notifications.failure_payload(
        run_name=f"refresh-{min(failed)}",
        source=EVENT_SOURCE,
        updated_at=datetime.now(timezone.utc),
        stage="refresh",
        reason=reason,
    )
    forecast_notifications.notify_once(notification_service.FORECAST_FAILURE, payload)
    return {"status": "failed", "reason": reason}


def fail_unstarted_best_effort(reason: str) -> None:
    """Record a final Cloud Tasks failure without hiding the original worker error."""
    try:
        with sql.connect_with_connector_autocommit().connect() as conn:
            pending = _pending(conn)
            running = _running(conn)
        if pending:
            _fail_pending(pending, reason)
        elif running:
            # A job already started; let a later task report its real outcome.
            forecast_refresh_events.enqueue_check(
                key=f"forecast-running-recovery-{int(time.time())}", delay_seconds=60
            )
    except Exception as exc:
        logger.warning("Could not record final forecast refresh failure: %s", exc)


def recover_best_effort() -> None:
    """Wake a stalled refresh after the Forecast response has been sent."""
    if not forecast_refresh_events.enabled():
        return
    try:
        with sql.connect_with_connector_autocommit().connect() as conn:
            stale = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM forecast_refresh_requests
                    WHERE (status = 'pending' AND created_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes')
                       OR (status = 'running' AND dispatched_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes')
                )
            """)).scalar_one()
        if stale:
            forecast_refresh_events.enqueue_check(
                key=f"forecast-recovery-{int(time.time() // 60)}", delay_seconds=0
            )
    except Exception as exc:
        logger.warning("Could not check stalled forecast refresh requests: %s", exc)


def refresh_status_best_effort() -> dict:
    """Whether a forecast refresh is waiting or running, for the Forecast page badge.

    One read of the outbox; any failure (or event refresh switched off, when
    nothing would ever process a waiting row) reads as not updating, so the
    badge can only ever be missing, never stuck or an error.
    """
    if not forecast_refresh_events.enabled():
        return {"updating": False, "since": None}
    try:
        with sql.connect_with_connector_autocommit().connect() as conn:
            since = conn.execute(text("""
                SELECT MIN(created_at) FROM forecast_refresh_requests
                WHERE status IN ('pending', 'running')
            """)).scalar()
    except Exception as exc:
        logger.warning("Could not read the forecast refresh status: %s", exc)
        return {"updating": False, "since": None}
    if since is None:
        return {"updating": False, "since": None}
    return {
        "updating": True,
        "since": since.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


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
        return client.get_job(job_id, location=config.BQ_FORECAST_LOCATION)
    except NotFound:
        try:
            return client.query(
                f"CALL `{config.BQ_FORECAST_DATASET}.retrain_if_new_month`(TRUE)",
                job_id=job_id,
                location=config.BQ_FORECAST_LOCATION,
                job_config=bigquery.QueryJobConfig(labels={"trigger": "fc_event"}),
            )
        except Conflict:
            return client.get_job(job_id, location=config.BQ_FORECAST_LOCATION)


def _run_outcome(job) -> tuple[bool, bool]:
    if not job.started or not job.ended:
        return False, False
    rows = _query_bigquery(
        f"SELECT COUNT(*) AS checked, COUNTIF(retrained) AS retrained FROM `{config.BQ_TRAINING_RUN_LOG_TABLE}` "
        "WHERE checked_at BETWEEN @started AND @ended",
        [
            bigquery.ScalarQueryParameter("started", "TIMESTAMP", job.started),
            bigquery.ScalarQueryParameter("ended", "TIMESTAMP", job.ended),
        ],
    )
    return bool(rows and rows[0]["checked"]), bool(rows and rows[0]["retrained"])


def latest_forecast_summary() -> dict:
    """Period, customers and products of the newest forecast run, for the
    success notification's detail lines (named as the bell shows them)."""

    query = f"""
        WITH latest AS (SELECT MAX(current_generated_at) AS generated_at FROM `{config.BQ_FORECAST_PIPELINE_VIEW}`)
        SELECT
            MIN(month_year) AS period_start,
            MAX(month_year) AS period_end,
            ARRAY_AGG(DISTINCT customer_id IGNORE NULLS) AS customer_ids,
            ARRAY_AGG(DISTINCT sku IGNORE NULLS) AS skus
        FROM `{config.BQ_FORECAST_PIPELINE_VIEW}`, latest
        WHERE current_generated_at = latest.generated_at
    """
    rows = list(get_bigquery_client().query(query).result())
    if not rows or rows[0]["period_start"] is None:
        return {"period_start": None, "period_end": None, "customers": [], "skus": []}

    row = rows[0]
    customer_names = {c["customer_id"]: c["customer_name"] for c in inventory_service.list_customers()}
    product_names = {s["sku"]: s["product_name"] for s in catalog_service.get_skus()}
    return {
        "period_start": str(row["period_start"]),
        "period_end": str(row["period_end"]),
        "customers": sorted(customer_names.get(cid, str(cid)) for cid in row["customer_ids"]),
        "skus": sorted(product_names.get(sku, sku) for sku in row["skus"]),
    }


def _summary_best_effort() -> dict:
    # A retrain that succeeded is still worth announcing when the summary
    # query behind its detail lines fails.
    try:
        return latest_forecast_summary()
    except Exception as exc:
        logger.warning("Could not summarise the latest forecast run: %s", exc)
        return forecast_notifications.EMPTY_SUMMARY


def _notify_outcome(job_id: str, job, failed: bool, warning: str | None = None) -> None:
    updated_at = job.ended or datetime.now(timezone.utc)
    if failed:
        reason, errors = forecast_notifications.job_failure(job)
        payload = forecast_notifications.failure_payload(
            run_name=job_id, source=EVENT_SOURCE, updated_at=updated_at,
            stage="pipeline", reason=reason, errors=errors,
        )
        forecast_notifications.notify_once(notification_service.FORECAST_FAILURE, payload)
        return
    payload = forecast_notifications.success_payload(
        run_name=job_id, source=EVENT_SOURCE, updated_at=updated_at,
        summary=_summary_best_effort(), warnings=[warning] if warning else [],
    )
    forecast_notifications.notify_once(notification_service.FORECAST_SUCCESS, payload)


def _finish(job_id: str, job) -> dict:
    failed = bool(job.error_result)
    warning = forecast_notifications.initial_refresh_warning(job) if failed else None
    if warning:
        # Only the Initial refresh failed (A9.1 raises it after rebuilding the
        # page table). When the retrain itself logged a success, announce that
        # success with the Initial as a warning, not the whole run as failed.
        checked, retrained = _run_outcome(job)
        failed = not retrained
    else:
        checked, retrained = _run_outcome(job) if not failed else (False, False)
    if not failed and not checked:
        # The routine returns without logging when another forecast is busy.
        # Keep the outbox pending and use a new BigQuery job ID on the next try,
        # unless the batch has already waited past FORECAST_REFRESH_MAX_WAIT:
        # then stop retrying and tell the bell the refresh couldn't start.
        with sql.connect_with_connector().begin() as conn:
            requeued = [dict(row) for row in conn.execute(text("""
                UPDATE forecast_refresh_requests
                SET status = 'pending', dispatched_at = NULL
                WHERE job_id = :job_id AND status = 'running'
                RETURNING id, created_at
            """), {"job_id": job_id}).mappings().all()]
        if requeued and _waited_too_long(requeued):
            return _fail_pending(
                requeued, f"Another forecast run was still in progress after {_max_wait_text()}"
            )
        return _retry_later()
    if retrained and not failed:
        # Before the batch is marked completed, so a Cloud Tasks retry that
        # finds it still running saves it again (the month's snapshot is
        # replaced, never doubled). Best effort, like the bell below.
        sell_in_snapshots.take_snapshot_best_effort()
    if failed or retrained:
        # Best effort and deduped on the job id: the batch status below must be
        # recorded even when the bell can't be written, and a Cloud Tasks retry
        # of this same job must not notify twice.
        _notify_outcome(job_id, job, failed, None if failed else warning)
    with sql.connect_with_connector().begin() as conn:
        conn.execute(text("""
            UPDATE forecast_refresh_requests
            SET status = :status, finished_at = CURRENT_TIMESTAMP, last_error = :error
            WHERE job_id = :job_id AND status = 'running'
        """), {
            "status": "failed" if failed else "completed",
            # The Initial warning is kept on a completed batch too, for the record.
            "error": str(job.error_result) if failed or warning else None,
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
        now = datetime.now(timezone.utc)
        if newest > now - timedelta(seconds=forecast_refresh_events.QUIET_SECONDS):
            return _retry_later()
        if not _inputs_landed(conn, pending):
            expired = newest <= now - _max_wait()
            return _fail_pending(pending, "Sales or catalog changes did not reach BigQuery before the refresh time limit") if expired else _retry_later()

    ids = [row["id"] for row in pending]
    previous_jobs = {row["job_id"] for row in pending if row.get("job_id")}
    job_id = _job_id(ids, next(iter(previous_jobs))) if len(previous_jobs) == 1 else _job_id(ids)
    if not _claim(ids, job_id):
        return _retry_later()
    job = _ensure_job(job_id)
    return _finish(job_id, job) if job.done() else _retry_later()
