"""Version and roll back transformed sell-out uploads.

Cloud SQL remains the current-state source of truth. ``sellout_versions`` is
an append-only audit trail used only to rebuild that current state when a bad
upload is rolled back; Datastream then replicates the resulting SQL changes.
"""

import datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sql


class IngestionNotFoundError(LookupError):
    """No transformed upload exists for the requested GCS object."""


class IngestionAlreadyRolledBackError(RuntimeError):
    """The latest transformation of this GCS object was already rolled back."""


class IngestionInProgressError(RuntimeError):
    """The upload cannot be rolled back while its transformation is running."""


class IngestionRollbackError(RuntimeError):
    """The rollback could not be completed atomically."""


VERSION_COLUMNS = (
    "retailer_id",
    "period_start",
    "period_end",
    "period_type",
    "store_code",
    "sku",
    "quantity_units",
    "revenue",
    "source_file",
    "loaded_at",
    "data_source",
)
BUSINESS_KEY = (
    "retailer_id",
    "store_code",
    "sku",
    "period_start",
    "period_type",
)


def _key(row: dict) -> tuple:
    return tuple(row[column] for column in BUSINESS_KEY)


def _version_params(row: dict, ingestion_id: int, *, is_deleted: bool) -> dict:
    return {
        "ingestion_id": ingestion_id,
        **{column: row.get(column) for column in VERSION_COLUMNS},
        "is_deleted": is_deleted,
    }


def start_run(
    connection: Connection,
    *,
    source_blob: str,
    source_file: str,
    content_hash: str | None,
    mapping_fingerprint: str | None,
    loaded_at: datetime.datetime,
) -> int:
    """Create the audit record in the same transaction as the sell-out load."""
    result = connection.execute(
        text(
            """
            INSERT INTO ingestion_runs (
                source_blob, source_file, content_hash,
                mapping_fingerprint, status, loaded_at
            ) VALUES (
                :source_blob, :source_file, :content_hash,
                :mapping_fingerprint, 'processing', :loaded_at
            )
            RETURNING ingestion_id
            """
        ),
        {
            "source_blob": source_blob,
            "source_file": source_file,
            "content_hash": content_hash,
            "mapping_fingerprint": mapping_fingerprint,
            "loaded_at": loaded_at,
        },
    )
    return int(result.scalar_one())


def _rows_replaced_by_upload(
    connection: Connection,
    ingestion_id: int,
) -> list[dict]:
    """Lock rows still owned by this GCS object's previous completed run."""
    rows = connection.execute(
        text(
            """
            WITH current_run AS (
                SELECT source_blob
                FROM ingestion_runs
                WHERE ingestion_id = :ingestion_id
            ),
            previous_run AS (
                SELECT prior.ingestion_id
                FROM ingestion_runs AS prior
                JOIN current_run
                    ON current_run.source_blob = prior.source_blob
                WHERE
                    prior.ingestion_id < :ingestion_id
                    AND prior.status = 'completed'
                ORDER BY prior.ingestion_id DESC
                LIMIT 1
            )
            SELECT
                current.retailer_id, current.period_start,
                current.period_end, current.period_type,
                current.store_code, current.sku,
                current.quantity_units, current.revenue,
                current.source_file, current.loaded_at,
                current.data_source
            FROM previous_run
            JOIN sellout_versions AS previous
                ON previous.ingestion_id = previous_run.ingestion_id
                AND previous.is_deleted = FALSE
            JOIN sellout AS current
                ON current.retailer_id = previous.retailer_id
                AND current.store_code = previous.store_code
                AND current.sku = previous.sku
                AND current.period_start = previous.period_start
                AND current.period_type = previous.period_type
                AND current.loaded_at = previous.loaded_at
                AND current.source_file IS NOT DISTINCT FROM previous.source_file
            FOR UPDATE OF current
            """
        ),
        {"ingestion_id": ingestion_id},
    ).mappings()
    return [dict(row) for row in rows]


def _capture_baselines(connection: Connection, rows: list[dict]) -> None:
    """Record the pre-versioning state once, including an absent-row tombstone."""
    if not rows:
        return
    connection.execute(
        text(
            """
            INSERT INTO sellout_versions (
                ingestion_id, retailer_id, period_start, period_end,
                period_type, store_code, sku, quantity_units, revenue,
                source_file, loaded_at, data_source, is_deleted
            )
            SELECT
                NULL, :retailer_id, :period_start,
                COALESCE(current.period_end, :period_end), :period_type,
                :store_code, :sku, current.quantity_units, current.revenue,
                CASE
                    WHEN current.retailer_id IS NULL THEN :source_file
                    ELSE current.source_file
                END,
                COALESCE(current.loaded_at, :loaded_at),
                COALESCE(current.data_source, :data_source),
                current.retailer_id IS NULL
            FROM (SELECT 1) AS baseline
            LEFT JOIN sellout AS current
                ON current.retailer_id = :retailer_id
                AND current.store_code = :store_code
                AND current.sku = :sku
                AND current.period_start = :period_start
                AND current.period_type = :period_type
            ON CONFLICT DO NOTHING
            """
        ),
        [
            {column: row.get(column) for column in VERSION_COLUMNS}
            for row in rows
        ],
    )


def _insert_versions(
    connection: Connection,
    ingestion_id: int,
    rows: list[dict],
    *,
    is_deleted: bool,
) -> None:
    if not rows:
        return
    columns = ", ".join(("ingestion_id", *VERSION_COLUMNS, "is_deleted"))
    values = ", ".join(f":{column}" for column in ("ingestion_id", *VERSION_COLUMNS, "is_deleted"))
    connection.execute(
        text(f"INSERT INTO sellout_versions ({columns}) VALUES ({values})"),
        [
            _version_params(row, ingestion_id, is_deleted=is_deleted)
            for row in rows
        ],
    )


def record_versions(
    connection: Connection,
    ingestion_id: int,
    facts: list[dict],
    *,
    replace_source: bool,
) -> list[dict]:
    """Record this run and return exact stale rows removed by a reload."""
    replaced = (
        _rows_replaced_by_upload(connection, ingestion_id)
        if replace_source
        else []
    )
    fact_keys = {_key(row) for row in facts}
    tombstones = [row for row in replaced if _key(row) not in fact_keys]
    affected = [*facts, *tombstones]

    _capture_baselines(connection, affected)
    _insert_versions(connection, ingestion_id, tombstones, is_deleted=True)
    _insert_versions(connection, ingestion_id, facts, is_deleted=False)
    return tombstones


def complete_run(
    connection: Connection,
    ingestion_id: int,
    *,
    rows_stored: int,
    rows_consolidated: int,
) -> None:
    connection.execute(
        text(
            """
            UPDATE ingestion_runs
            SET
                status = 'completed',
                rows_stored = :rows_stored,
                rows_consolidated = :rows_consolidated
            WHERE ingestion_id = :ingestion_id
            """
        ),
        {
            "ingestion_id": ingestion_id,
            "rows_stored": rows_stored,
            "rows_consolidated": rows_consolidated,
        },
    )


def upload_states(
    blob_paths: list[str], *, engine: Engine | None = None
) -> dict[str, dict]:
    """Return the newest transformation state for each requested GCS object."""
    if not blob_paths:
        return {}

    parameters = {f"blob_{index}": path for index, path in enumerate(blob_paths)}
    placeholders = ", ".join(f":{name}" for name in parameters)
    database = engine or sql.connect_with_connector_autocommit()
    with database.connect() as connection:
        rows = connection.execute(
            text(
                f"""
                SELECT DISTINCT ON (source_blob)
                    source_blob, ingestion_id, status, rows_stored,
                    rows_consolidated, loaded_at, rolled_back_at,
                    rolled_back_by, rollback_reason
                FROM ingestion_runs
                WHERE source_blob IN ({placeholders})
                ORDER BY source_blob, ingestion_id DESC
                """
            ),
            parameters,
        ).mappings()
        return {row["source_blob"]: dict(row) for row in rows}


def _latest_active_versions(connection: Connection, ingestion_id: int) -> list[dict]:
    rows = connection.execute(
        text(
            """
            WITH affected AS (
                SELECT DISTINCT
                    retailer_id, store_code, sku, period_start, period_type
                FROM sellout_versions
                WHERE ingestion_id = :ingestion_id
            )
            SELECT DISTINCT ON (
                version.retailer_id, version.store_code, version.sku,
                version.period_start, version.period_type
            )
                version.version_id, version.ingestion_id,
                version.retailer_id, version.period_start,
                version.period_end, version.period_type,
                version.store_code, version.sku,
                version.quantity_units, version.revenue,
                version.source_file, version.loaded_at,
                version.data_source, version.is_deleted
            FROM sellout_versions AS version
            JOIN affected USING (
                retailer_id, store_code, sku, period_start, period_type
            )
            LEFT JOIN ingestion_runs AS run
                ON run.ingestion_id = version.ingestion_id
            WHERE
                version.ingestion_id IS NULL
                OR run.status = 'completed'
            ORDER BY
                version.retailer_id, version.store_code, version.sku,
                version.period_start, version.period_type,
                version.version_id DESC
            """
        ),
        {"ingestion_id": ingestion_id},
    ).mappings()
    return [dict(row) for row in rows]


def _delete_affected_current_rows(connection: Connection, ingestion_id: int) -> int:
    result = connection.execute(
        text(
            """
            DELETE FROM sellout AS current
            USING (
                SELECT DISTINCT
                    retailer_id, store_code, sku, period_start, period_type
                FROM sellout_versions
                WHERE ingestion_id = :ingestion_id
            ) AS affected
            WHERE
                current.retailer_id = affected.retailer_id
                AND current.store_code = affected.store_code
                AND current.sku = affected.sku
                AND current.period_start = affected.period_start
                AND current.period_type = affected.period_type
            """
        ),
        {"ingestion_id": ingestion_id},
    )
    return int(result.rowcount or 0)


def _restore_versions(connection: Connection, versions: list[dict]) -> int:
    active = [row for row in versions if not row["is_deleted"]]
    if not active:
        return 0
    columns = ", ".join(VERSION_COLUMNS)
    values = ", ".join(f":{column}" for column in VERSION_COLUMNS)
    connection.execute(
        text(
            f"""
            INSERT INTO sellout ({columns})
            VALUES ({values})
            ON CONFLICT (
                retailer_id, store_code, sku, period_start, period_type
            ) DO UPDATE SET
                period_end = EXCLUDED.period_end,
                quantity_units = EXCLUDED.quantity_units,
                revenue = EXCLUDED.revenue,
                source_file = EXCLUDED.source_file,
                loaded_at = EXCLUDED.loaded_at,
                data_source = EXCLUDED.data_source
            """
        ),
        [{column: row[column] for column in VERSION_COLUMNS} for row in active],
    )
    return len(active)


def rollback_upload(
    source_blob: str,
    *,
    rolled_back_by: str,
    reason: str | None = None,
    engine: Engine | None = None,
) -> dict:
    """Roll back the latest transformation of one GCS object atomically."""
    database = engine or sql.connect_with_connector()
    try:
        with database.begin() as connection:
            run = connection.execute(
                text(
                    """
                    SELECT
                        ingestion_id, source_blob, source_file, status,
                        rows_stored, loaded_at
                    FROM ingestion_runs
                    WHERE source_blob = :source_blob
                    ORDER BY ingestion_id DESC
                    LIMIT 1
                    FOR UPDATE
                    """
                ),
                {"source_blob": source_blob},
            ).mappings().first()
            if run is None:
                raise IngestionNotFoundError(
                    "No completed transformation was found for this upload."
                )
            if run["status"] == "rolled_back":
                raise IngestionAlreadyRolledBackError(
                    "This upload has already been rolled back."
                )
            if run["status"] != "completed":
                raise IngestionInProgressError(
                    "This upload is still being transformed and cannot be rolled back yet."
                )

            ingestion_id = int(run["ingestion_id"])
            connection.execute(
                text(
                    """
                    UPDATE ingestion_runs
                    SET
                        status = 'rolled_back',
                        rolled_back_at = CURRENT_TIMESTAMP,
                        rolled_back_by = :rolled_back_by,
                        rollback_reason = :reason
                    WHERE ingestion_id = :ingestion_id
                    """
                ),
                {
                    "ingestion_id": ingestion_id,
                    "rolled_back_by": rolled_back_by,
                    "reason": reason,
                },
            )

            versions = _latest_active_versions(connection, ingestion_id)
            rows_removed_from_current = _delete_affected_current_rows(
                connection, ingestion_id
            )
            rows_restored = _restore_versions(connection, versions)

            return {
                "ingestion_id": ingestion_id,
                "source_blob": run["source_blob"],
                "source_file": run["source_file"],
                "status": "rolled_back",
                "rows_affected": rows_removed_from_current,
                "rows_restored": rows_restored,
                "rows_removed": max(rows_removed_from_current - rows_restored, 0),
            }
    except (
        IngestionNotFoundError,
        IngestionAlreadyRolledBackError,
        IngestionInProgressError,
    ):
        raise
    except Exception as exc:
        raise IngestionRollbackError(f"Upload rollback failed: {exc}") from exc
