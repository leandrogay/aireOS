"""
The one payload shape every forecast notification uses, whichever path raised
it: the event-driven refresh (forecast_refresh_worker), the scheduled BigQuery
run (forecast_pipeline_events) and the forecast script (scripts/refresh_forecast.py).

The bell (frontend NotificationPanel / utils/forecastNotificationText.js) reads
these keys by name, so they are built here once rather than as dict literals in
each producer:

    run_name   str   unique per outcome; has_forecast_run() dedupes on it
    source     "event" | "scheduled" | "script"   -> "Started by"
    stage      "pipeline" | "refresh"   (failures; "refresh" = the retrain never started)
    reason     str | None   plain-language cause (failures)
    errors     list[str]    detail lines, e.g. from the BigQuery job (failures)
    period_start, period_end, customers, skus   what was forecast (successes)
    updated_at ISO timestamp, UTC

Pure builders plus one best-effort writer; no BigQuery or forecast logic here.
"""

import logging
from datetime import datetime

from app.services import notification_service

logger = logging.getLogger("uvicorn.error")

SOURCES = ("event", "scheduled", "script")
STAGES = ("pipeline", "refresh")

EMPTY_SUMMARY = {"period_start": None, "period_end": None, "customers": [], "skus": []}

DEFAULT_JOB_FAILURE_REASON = "The forecast retrain failed in BigQuery."


def _timestamp(value: datetime | str) -> str:
    return value.isoformat() if isinstance(value, datetime) else str(value)


def _check(source: str, stage: str = "pipeline") -> None:
    if source not in SOURCES:
        raise ValueError(f"Unknown forecast notification source: {source}")
    if stage not in STAGES:
        raise ValueError(f"Unknown forecast notification stage: {stage}")


def success_payload(
    *,
    run_name: str,
    source: str,
    updated_at: datetime | str,
    summary: dict | None = None,
) -> dict:
    """A finished retrain: what was forecast, from latest_forecast_summary()."""
    _check(source)
    summary = summary or EMPTY_SUMMARY
    return {
        "run_name": run_name,
        "source": source,
        "stage": "pipeline",
        "reason": None,
        "errors": [],
        "period_start": summary.get("period_start"),
        "period_end": summary.get("period_end"),
        "customers": list(summary.get("customers") or []),
        "skus": list(summary.get("skus") or []),
        "updated_at": _timestamp(updated_at),
    }


def failure_payload(
    *,
    run_name: str,
    source: str,
    updated_at: datetime | str,
    reason: str,
    stage: str = "pipeline",
    errors: list[str] | None = None,
) -> dict:
    """A retrain that failed ("pipeline") or never started ("refresh")."""
    _check(source, stage)
    return {
        "run_name": run_name,
        "source": source,
        "stage": stage,
        "reason": reason,
        "errors": [str(error) for error in errors or []],
        "period_start": None,
        "period_end": None,
        "customers": [],
        "skus": [],
        "updated_at": _timestamp(updated_at),
    }


def job_failure(job) -> tuple[str, list[str]]:
    """(reason, errors) for a failed BigQuery job: the headline message, then
    every error the job reported (error_result is only the first of them)."""
    error_result = job.error_result or {}
    reason = error_result.get("message") or DEFAULT_JOB_FAILURE_REASON
    errors = [
        error.get("message") or str(error)
        for error in (getattr(job, "errors", None) or [error_result])
        if error
    ]
    return reason, errors


def notify_once(notification_type: str, payload: dict) -> int | None:
    """
    Writes the notification unless one already exists for its run_name, and
    never raises: a forecast outcome must still be recorded (and the task must
    not 503 into a retry loop) when the notification itself can't be written.
    Returns the new id, or None when skipped or failed (logged).
    """
    run_name = payload.get("run_name")
    try:
        if run_name and notification_service.has_forecast_run(run_name):
            return None
    except Exception as exc:
        logger.warning("Could not check for an existing %s notification for %s: %s", notification_type, run_name, exc)
        return None
    return notification_service.insert_best_effort(notification_type, payload)
