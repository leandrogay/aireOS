"""Persist validated sell-out rows to the normalised Cloud SQL schema."""

import datetime
import os

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import catalog_service, sql


class SelloutLoadError(RuntimeError):
    """Validated rows could not be stored atomically in Cloud SQL."""


BUSINESS_KEY = ("retailer", "store_code", "sku", "period_start", "period_type")


def _consolidate_records(records: list[dict]) -> list[dict]:
    """Combine source rows that map to the same sell-out business record.

    FairPrice can report the same product/store/period under both CAR and EA
    sales UOMs. quantity_units is already supplied in EA, so when UOM is not
    part of the agreed fact schema the lossless representation is one row with
    additive quantity and revenue.
    """
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

        # The SKU master has one UOM. Prefer EA when the source supplies both
        # EA and CAR for a quantity that is explicitly measured in EA.
        if str(row.get("uom") or "").upper() == "EA":
            current["uom"] = row["uom"]

    return list(consolidated.values())


def cloud_sql_loading_enabled() -> bool:
    return os.environ.get("CLOUD_SQL_LOAD_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _insert_missing_sku(connection: Connection, row: dict) -> None:
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


def load_clean_rows(
    dataframe: pd.DataFrame,
    *,
    replace_source: bool = False,
    engine: Engine | None = None,
    loaded_at: datetime.datetime | None = None,
) -> dict:
    """Reuse catalog references, add missing SKUs, and upsert facts atomically."""
    if dataframe.empty:
        return {
            "rows_stored": 0,
            "rows_consolidated": 0,
            "storage_status": "completed",
        }

    database = engine or sql.connect_with_connector()
    timestamp = loaded_at or datetime.datetime.now(datetime.timezone.utc)
    input_records = dataframe.astype(object).where(dataframe.notna(), None).to_dict("records")
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

    try:
        with database.begin() as connection:
            if replace_source:
                source_files = sorted({row["source_file"] for row in records if row.get("source_file")})
                for source_file in source_files:
                    connection.execute(
                        text("DELETE FROM sellout WHERE source_file = :source_file"),
                        {"source_file": source_file},
                    )

            retailer_ids: dict[str, int] = {}
            stores_seen: set[tuple[int, str]] = set()
            skus_seen: set[str] = set()
            facts: list[dict] = []

            for row in records:
                retailer = str(row["retailer"])
                retailer_id = retailer_ids.get(retailer)
                if retailer_id is None:
                    retailer_id = catalog_service.get_or_create_retailer(connection, retailer)
                    retailer_ids[retailer] = retailer_id

                store_key = (retailer_id, str(row["store_code"]))
                if store_key not in stores_seen:
                    catalog_service.get_or_create_store(
                        connection,
                        retailer_id,
                        row.get("store_name") or row["store_code"],
                        row["store_code"],
                        row.get("store_format"),
                    )
                    stores_seen.add(store_key)

                sku = str(row["sku"])
                if sku not in skus_seen:
                    _insert_missing_sku(connection, row)
                    skus_seen.add(sku)

                fact_record = {
                    "retailer_id": retailer_id,
                    "period_start": row["period_start"],
                    "period_end": row["period_end"],
                    "period_type": row["period_type"],
                    "store_code": row["store_code"],
                    "sku": sku,
                    "quantity_units": row.get("quantity_units"),
                    "revenue": row.get("revenue"),
                    "source_file": row.get("source_file"),
                    "loaded_at": timestamp,
                    "data_source": "aireos_upload",
                }
                facts.append(fact_record)

            _upsert_sellout(connection, facts)
    except Exception as exc:
        raise SelloutLoadError(f"Cloud SQL sell-out load failed: {exc}") from exc

    return {
        "rows_stored": len(records),
        "rows_consolidated": len(input_records) - len(records),
        "storage_status": "completed",
    }
