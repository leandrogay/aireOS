"""
Turns each finished run of the scheduled BigQuery forecast ("Retrain when new
month lands", which CALLs retrain_if_new_month) into a notification.

BigQuery cannot write to Cloud SQL, so the scheduled query publishes every
finished run to a Pub/Sub topic, and this listens on a subscription to it. The
subscription is the queue: runs are handled one at a time in arrival order,
and a message is acknowledged only once handled, so a failure is retried
rather than lost.

The schedule runs daily but only retrains when a new month of data is in, so
a successful run is notified only if it logged retrained=TRUE in the
training-run log; a failed run is always notified.
"""

import json
import logging

from google.cloud import bigquery as bq
from google.cloud import pubsub_v1
from google.oauth2 import service_account

from app import config
from app.services import catalog_service, inventory_service, notification_service
from app.services.bigquery import get_bigquery_client

logger = logging.getLogger("uvicorn.error")

SOURCE = "scheduled"


def _retrained_during(start_time: str, end_time: str) -> bool:
    query = f"""
        SELECT COUNTIF(retrained) AS retrained
        FROM `{config.BQ_TRAINING_RUN_LOG_TABLE}`
        WHERE checked_at BETWEEN @start_time AND @end_time
    """
    job_config = bq.QueryJobConfig(
        query_parameters=[
            bq.ScalarQueryParameter("start_time", "TIMESTAMP", start_time),
            bq.ScalarQueryParameter("end_time", "TIMESTAMP", end_time),
        ]
    )
    rows = list(get_bigquery_client().query(query, job_config=job_config).result())
    return bool(rows and rows[0]["retrained"])


def _latest_forecast_summary() -> dict:
    """Period, customers and products of the newest forecast run, named the way
    the script-run notification names them."""

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


def handle_transfer_run(run: dict) -> int | None:
    """
    One finished run, as the TransferRun JSON BigQuery publishes. Returns the
    new notification's id, or None when the run needs none (no retrain, a
    state other than succeeded/failed, or already notified).
    """

    run_name = run.get("name") or ""
    state = run.get("state")
    if state not in ("SUCCEEDED", "FAILED") or not run_name:
        return None
    if notification_service.has_forecast_run(run_name):
        return None

    finished_at = run.get("endTime") or run.get("updateTime")
    if state == "FAILED":
        message = (run.get("errorStatus") or {}).get("message") or "The scheduled forecast run failed."
        payload = {
            "period_start": None,
            "period_end": None,
            "customers": [],
            "skus": [],
            "updated_at": finished_at,
            "errors": [message],
            "source": SOURCE,
            "run_name": run_name,
        }
        return notification_service.insert(notification_service.FORECAST_FAILURE, payload)

    if not _retrained_during(run.get("startTime") or run.get("runTime"), finished_at):
        return None
    payload = {
        **_latest_forecast_summary(),
        "updated_at": finished_at,
        "errors": [],
        "source": SOURCE,
        "run_name": run_name,
    }
    return notification_service.insert(notification_service.FORECAST_SUCCESS, payload)


def _on_message(message) -> None:
    try:
        handle_transfer_run(json.loads(message.data.decode("utf-8")))
        message.ack()
    except Exception as exc:
        # Redelivered later (with the subscription's retry back-off), not lost.
        logger.warning("Could not handle a forecast run message: %s", exc)
        message.nack()


def start_listening():
    """
    Starts pulling from FORECAST_PIPELINE_SUBSCRIPTION on Pub/Sub's own
    threads, one message at a time. Returns the future to cancel on shutdown,
    or None when no subscription is configured.
    """

    if not config.FORECAST_PIPELINE_SUBSCRIPTION:
        return None
    credentials = service_account.Credentials.from_service_account_file(
        config.require_file("GOOGLE_APPLICATION_CREDENTIALS"),
        scopes=["https://www.googleapis.com/auth/pubsub"],
    )
    client = pubsub_v1.SubscriberClient(credentials=credentials)
    path = client.subscription_path(config.require("GCP_PROJECT_ID"), config.FORECAST_PIPELINE_SUBSCRIPTION)
    logger.info("Listening for scheduled forecast runs on %s", path)
    return client.subscribe(
        path,
        callback=_on_message,
        flow_control=pubsub_v1.types.FlowControl(max_messages=1),
    )
