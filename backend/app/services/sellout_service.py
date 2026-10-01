"""Persist validated sell-out rows to the normalised Cloud SQL schema."""

import datetime
from collections import Counter

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app import config
from app.services import catalog_service, sql


class SelloutLoadError(RuntimeError):
    """Validated rows could not be stored atomically in Cloud SQL."""


BUSINESS_KEY = ("retailer", "store_code", "sku", "period_start", "period_type")
SELLOUT_COLUMNS = (
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
_BULK_UPSERT_THRESHOLD = 100
_BULK_UPSERT_BATCH_SIZE = 500


def _consolidate_records(records: list[dict]) -> list[dict]:
    """Combine source rows that resolve to the same sell-out business key."""
    consolidated: dict[tuple, dict] = {}
    for row in records:
        key = tuple(row[field] for field in BUSINESS_KEY)
        current = consolidated.get(key)
        if current is None:
            consolidated[key] = dict(row)
            continue

        for metric in ("quantity_units", "revenue"):
            left = current.get(metric)
            right = row.get(metric)
            if left is None:
                current[metric] = right
            elif right is not None:
                current[metric] = left + right

        if str(row.get("uom") or "").upper() == "EA":
            current["uom"] = row["uom"]

    return list(consolidated.values())


def _prepare_records(dataframe: pd.DataFrame) -> tuple[list[dict], int]:
    """Normalise types and consolidate rows exactly as the load will."""
    input_records = (
        dataframe.astype(object).where(dataframe.notna(), None).to_dict("records")
    )
    records = _consolidate_records(input_records)
    for row in records:
        for field in ("period_start", "period_end"):
            value = row.get(field)
            if isinstance(value, str):
                row[field] = datetime.date.fromisoformat(value)
        if row.get("pack_size") is not None:
            row["pack_size"] = int(row["pack_size"])
        for field in ("quantity_units", "revenue"):
            if row.get(field) is not None:
                row[field] = float(row[field])
    return records, len(input_records) - len(records)


def summarize_clean_rows(dataframe: pd.DataFrame) -> dict:
    """Return the exact dry-run counts that ``load_clean_rows`` will use."""
    if dataframe.empty:
        return {
            "rows_input": 0,
            "rows_stored": 0,
            "rows_consolidated": 0,
            "retailers": {},
            "sku_count": 0,
            "first_period": None,
            "last_period": None,
        }

    records, rows_consolidated = _prepare_records(dataframe)
    periods = [row["period_start"] for row in records]
    return {
        "rows_input": len(dataframe),
        "rows_stored": len(records),
        "rows_consolidated": rows_consolidated,
        "retailers": dict(
            sorted(Counter(row["retailer"] for row in records).items())
        ),
        "sku_count": len({str(row["sku"]) for row in records}),
        "first_period": min(periods),
        "last_period": max(periods),
    }


def cloud_sql_loading_enabled() -> bool:
    return config.cloud_sql_loading_enabled()


def _insert_missing_sku(connection: Connection, row: dict) -> None:
    """Add a new SKU without ever changing an existing master record."""
    connection.execute(
        text(
            """
            INSERT INTO skus (
                sku, sku_range, product_name,
                size, brand, uom, pack_size, price
            ) VALUES (
                :sku, :sku_range, :product_name,
                :size, :brand, :uom, :pack_size, NULL
            )
            ON CONFLICT (sku)
            DO NOTHING
            """
        ),
        {
            "sku": row["sku"],
            "sku_range": row.get("sku_range"),
            "product_name": row.get("product_name"),
            "size": row.get("size"),
            "brand": row.get("brand"),
            "uom": row.get("uom"),
            "pack_size": row.get("pack_size"),
        },
    )


def _upsert_sellout(connection: Connection, records: list[dict]) -> None:
    if len(records) > _BULK_UPSERT_THRESHOLD:
        _upsert_sellout_in_batches(connection, records)
        return

    connection.execute(
        text(
            """
            INSERT INTO sellout (
                retailer_id, period_start, period_end, period_type,
                store_code, sku, quantity_units, revenue, source_file,
                loaded_at, data_source
            ) VALUES (
                :retailer_id, :period_start, :period_end, :period_type,
                :store_code, :sku, :quantity_units, :revenue, :source_file,
                :loaded_at, :data_source
            )
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
        records,
    )


def _upsert_sellout_in_batches(connection: Connection, records: list[dict]) -> None:
    """Use multi-row statements so large imports are not sent row by row."""
    columns_sql = ", ".join(SELLOUT_COLUMNS)
    for batch_start in range(0, len(records), _BULK_UPSERT_BATCH_SIZE):
        batch = records[batch_start : batch_start + _BULK_UPSERT_BATCH_SIZE]
        parameters = {}
        value_rows = []
        for index, record in enumerate(batch):
            placeholders = []
            for column in SELLOUT_COLUMNS:
                parameter = f"{column}_{index}"
                placeholders.append(f":{parameter}")
                parameters[parameter] = record[column]
            value_rows.append(f"({', '.join(placeholders)})")

        connection.execute(
            text(
                f"""
                INSERT INTO sellout ({columns_sql})
                VALUES {', '.join(value_rows)}
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
            parameters,
        )


def load_clean_rows(
    dataframe: pd.DataFrame,
    *,
    replace_source: bool = False,
    data_source: str = "aireos_upload",
    engine: Engine | None = None,
    loaded_at: datetime.datetime | None = None,
) -> dict:
    """Add missing catalogue rows and upsert sell-out facts atomically."""
    if dataframe.empty:
        return {
            "rows_stored": 0,
            "rows_consolidated": 0,
            "storage_status": "completed",
        }

    if not data_source.strip():
        raise ValueError("data_source must not be blank")

    database = engine or sql.connect_with_connector()
    timestamp = loaded_at or datetime.datetime.now(datetime.timezone.utc)
    records, rows_consolidated = _prepare_records(dataframe)

    try:
        with database.begin() as connection:
            if replace_source:
                source_files = sorted(
                    {
                        row["source_file"]
                        for row in records
                        if row.get("source_file")
                    }
                )
                for source_file in source_files:
                    connection.execute(
                        text("DELETE FROM sellout WHERE source_file = :source_file"),
                        {"source_file": source_file},
                    )

            retailer_names = list(
                dict.fromkeys(str(row["retailer"]) for row in records)
            )
            retailer_ids = catalog_service.get_or_create_retailers(
                connection, retailer_names
            )

            stores_by_key: dict[tuple[int, str], dict] = {}
            for row in records:
                retailer_id = retailer_ids[str(row["retailer"])]
                store_code = str(row["store_code"])
                stores_by_key.setdefault(
                    (retailer_id, store_code),
                    {
                        "retailer_id": retailer_id,
                        "store_code": store_code,
                        "store_name": row.get("store_name") or store_code,
                        "store_format": row.get("store_format"),
                    },
                )

            catalog_service.get_or_create_stores(
                connection, list(stores_by_key.values())
            )

            skus_seen: set[str] = set()
            facts: list[dict] = []
            for row in records:
                retailer_id = retailer_ids[str(row["retailer"])]
                sku = str(row["sku"])
                if sku not in skus_seen:
                    _insert_missing_sku(connection, row)
                    skus_seen.add(sku)

                facts.append(
                    {
                        "retailer_id": retailer_id,
                        "period_start": row["period_start"],
                        "period_end": row["period_end"],
                        "period_type": row["period_type"],
                        "store_code": str(row["store_code"]),
                        "sku": sku,
                        "quantity_units": row.get("quantity_units"),
                        "revenue": row.get("revenue"),
                        "source_file": row.get("source_file"),
                        "loaded_at": timestamp,
                        "data_source": data_source,
                    }
                )

            _upsert_sellout(connection, facts)
    except Exception as exc:
        raise SelloutLoadError(f"Cloud SQL sell-out load failed: {exc}") from exc

    return {
        "rows_stored": len(records),
        "rows_consolidated": rows_consolidated,
        "storage_status": "completed",
    }
