"""One-time, versioned recovery of FairPrice weekly rows from legacy BigQuery.

Run without --apply for a read-only preview. The original retailer exports are
no longer in the current upload bucket; an immutable CSV snapshot is saved in
GCS before each SQL load so the ingestion run has a real source object.
"""

import argparse
import csv
import hashlib
import io
import math
import sys
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pandas as pd
from google.cloud import bigquery
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config
from app.services import sellout_service, sql, storage
from app.services.bigquery import get_bigquery_client


SOURCE_TABLE = "aire-data.Aire_Data_Analytics.public_sellout"
TARGET_INSTANCE = "aire-data:asia-southeast1:aireos-postgresql"
EXPECTED = {
    "XEL_VENDORS_BRANDS_WEEK_26-12-2024_25-12-2025_1.txt": (2348, Decimal("23972"), Decimal("214222.28")),
    "XEL_VENDORS_BRANDS_WEEK_01-01-2026_13-08-2026_1.txt": (2588, Decimal("18793"), Decimal("189009.79")),
}
SNAPSHOT_COLUMNS = (
    "retailer_id", "store_code", "sku", "period_start", "period_end",
    "period_type", "quantity_units", "revenue", "source_file",
    "loaded_at", "data_source",
)


def _source_rows() -> dict[str, list[dict]]:
    query = f"""
        SELECT {', '.join(SNAPSHOT_COLUMNS)}
        FROM `{SOURCE_TABLE}`
        WHERE period_type = 'week' AND source_file IN UNNEST(@source_files)
        ORDER BY source_file, retailer_id, store_code, sku, period_start
    """
    config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ArrayQueryParameter("source_files", "STRING", list(EXPECTED)),
    ])
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in get_bigquery_client().query(query, job_config=config).result():
        grouped[row["source_file"]].append(dict(row))
    return grouped


def _check_source(filename: str, rows: list[dict]) -> None:
    expected_count, expected_quantity, expected_revenue = EXPECTED[filename]
    if len(rows) != expected_count:
        raise ValueError(f"{filename}: expected {expected_count} rows, found {len(rows)}")
    keys = {
        (row["retailer_id"], row["store_code"], row["sku"], row["period_start"], row["period_type"])
        for row in rows
    }
    if len(keys) != len(rows):
        raise ValueError(f"{filename}: duplicate business keys in the source")
    if {row["retailer_id"] for row in rows} - {55, 57}:
        raise ValueError(f"{filename}: unexpected retailer ID")
    if any(row["period_end"] - row["period_start"] != timedelta(days=6) for row in rows):
        raise ValueError(f"{filename}: a weekly period is not seven days")
    if any(
        row["quantity_units"] is None or row["revenue"] is None
        or not math.isfinite(row["quantity_units"]) or not math.isfinite(row["revenue"])
        for row in rows
    ):
        raise ValueError(f"{filename}: missing or non-finite sales values")
    quantity = sum((Decimal(str(row["quantity_units"])) for row in rows), Decimal(0))
    revenue = sum((Decimal(str(row["revenue"])) for row in rows), Decimal(0)).quantize(Decimal("0.01"))
    if quantity != expected_quantity or revenue != expected_revenue:
        raise ValueError(f"{filename}: quantity or revenue differs from the reviewed source totals")


def _catalog(engine) -> tuple[dict[int, str], dict[tuple[int, str], str], set[str]]:
    with engine.connect() as connection:
        database = connection.execute(text("SELECT current_database()" )).scalar_one()
        if database != "aireos":
            raise ValueError(f"Expected Singapore aireos database, got {database}")
        retailers = {
            row.retailer_id: row.retailer_name
            for row in connection.execute(text(
                "SELECT retailer_id, retailer_name FROM retailers WHERE retailer_id IN (55, 57)"
            ))
        }
        stores = {
            (row.retailer_id, str(row.store_code)): row.store_name
            for row in connection.execute(text(
                "SELECT retailer_id, store_code, store_name FROM stores WHERE retailer_id IN (55, 57)"
            ))
        }
        skus = {row.sku for row in connection.execute(text("SELECT sku FROM skus"))}
    if retailers != {55: "fairprice_online", 57: "fairprice_offline"}:
        raise ValueError(f"Unexpected FairPrice retailer catalog: {retailers}")
    return retailers, stores, skus


def _mapped_rows(rows: list[dict], retailers: dict, stores: dict, skus: set) -> pd.DataFrame:
    missing_stores = {
        (row["retailer_id"], str(row["store_code"]))
        for row in rows if (row["retailer_id"], str(row["store_code"])) not in stores
    }
    missing_skus = {row["sku"] for row in rows if row["sku"] not in skus}
    if missing_stores or missing_skus:
        raise ValueError(f"Missing Singapore catalog references: stores={missing_stores}, skus={missing_skus}")
    return pd.DataFrame([
        {
            "retailer": retailers[row["retailer_id"]],
            "store_code": str(row["store_code"]),
            "store_name": stores[(row["retailer_id"], str(row["store_code"]))],
            "sku": row["sku"],
            "period_start": row["period_start"],
            "period_end": row["period_end"],
            "period_type": row["period_type"],
            "quantity_units": row["quantity_units"],
            "revenue": row["revenue"],
            "source_file": row["source_file"],
        }
        for row in rows
    ])


def _snapshot(rows: list[dict]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=SNAPSHOT_COLUMNS)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row[key] for key in SNAPSHOT_COLUMNS})
    return output.getvalue().encode("utf-8")


def _store_snapshot(path: str, data: bytes, content_hash: str) -> None:
    blob = storage.get_storage_client().bucket(storage.BUCKET_NAME).blob(path)
    if blob.exists():
        existing = hashlib.sha256(blob.download_as_bytes()).hexdigest()
        if existing != content_hash:
            raise ValueError(f"Existing GCS snapshot differs: {path}")
        return
    blob.metadata = {"source_table": SOURCE_TABLE, "sha256": content_hash}
    blob.upload_from_string(data, content_type="text/csv", if_generation_match=0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Store GCS snapshots and load Singapore SQL")
    args = parser.parse_args()
    if config.require("POSTGRESQL_INSTANCE_CONNECTION_NAME") != TARGET_INSTANCE:
        raise ValueError("Backend environment must point at the Singapore Cloud SQL instance")

    print("Reading legacy BigQuery source rows...", flush=True)
    sources = _source_rows()
    print("Checking Singapore Cloud SQL catalog...", flush=True)
    engine = sql.connect_with_connector_autocommit()
    try:
        retailers, stores, skus = _catalog(engine)
        prepared = []
        for filename in EXPECTED:
            rows = sources.get(filename, [])
            _check_source(filename, rows)
            mapped = _mapped_rows(rows, retailers, stores, skus)
            summary = sellout_service.summarize_clean_rows(mapped)
            overlap = sellout_service.existing_overlap(mapped, engine=engine)
            if summary["rows_stored"] != len(rows) or overlap["rows_replaced"] or overlap["overwrites"]:
                raise ValueError(f"{filename}: consolidation or existing-row overlap detected: {summary}, {overlap}")
            snapshot = _snapshot(rows)
            content_hash = hashlib.sha256(snapshot).hexdigest()
            blob_path = f"backfills/fairprice/{filename}.csv"
            prepared.append((filename, mapped, snapshot, content_hash, blob_path))
            print(f"READY {filename}: {len(rows)} rows, {summary['first_period']} to {summary['last_period']}, no overlaps", flush=True)

        if not args.apply:
            print("Dry run complete. Re-run with --apply to store the snapshots and load SQL.")
            return

        for filename, mapped, snapshot, content_hash, blob_path in prepared:
            _store_snapshot(blob_path, snapshot, content_hash)
            result = sellout_service.load_clean_rows(
                mapped,
                data_source="legacy_bigquery_backfill",
                source_blob=blob_path,
                content_hash=content_hash,
            )
            print(f"LOADED {filename}: {result}")

        with engine.connect() as connection:
            for filename, _, _, _, _ in prepared:
                stored = connection.execute(text(
                    "SELECT COUNT(*) FROM sellout WHERE source_file = :filename AND period_type = 'week'"
                ), {"filename": filename}).scalar_one()
                if stored != EXPECTED[filename][0]:
                    raise RuntimeError(f"Post-load row count differs for {filename}: {stored}")
                print(f"VERIFIED {filename}: {stored} weekly rows in Singapore SQL")
    finally:
        sql.close_database()


if __name__ == "__main__":
    main()
