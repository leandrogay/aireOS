"""Repair five orphaned calendar-import batches in Singapore Cloud SQL.

Dry run by default. --apply snapshots the old links in GCS, restores Prime's
reviewed outlet catalog, then replaces dead store IDs in one SQL transaction.
The user approved applying each promotion to all current stores in its scope.
"""

import argparse
import csv
import hashlib
import io
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import config
from app.services import sql, storage

TARGET_INSTANCE = "aire-data:asia-southeast1:aireos-postgresql"
SNAPSHOT_PATH = "backfills/promotions/orphan-store-links-before-2026-11-04.csv"
GROUPS = (
    ("sheng_siong_offline", 33, 137, 190, 54),
    ("sheng_siong_online", 2, 194, 277, 84),
    ("prime_offline", 14, 290, 390, 98),
    ("nhg_offline", 1, 404, 436, 33),
    ("singhealth", 12, 440, 472, 33),
)
PRIME_CODES = (
    "106", "116", "159A", "25A", "263", "365", "373", "761",
    "962", "EC37", "KG", "TPY", "WLM", "YBS",
)


def _orphan_groups(conn) -> dict[str, list[dict]]:
    rows = conn.execute(text("""
        SELECT ps.promotion_id, ps.store_id
        FROM promotion_stores ps
        LEFT JOIN stores s ON s.store_id = ps.store_id
        WHERE s.store_id IS NULL
        ORDER BY ps.promotion_id, ps.store_id
    """)).mappings().all()
    groups = {}
    for scope, old_count, first_id, last_id, expected_promotions in GROUPS:
        links = [dict(row) for row in rows if first_id <= row["promotion_id"] <= last_id]
        ids = {row["promotion_id"] for row in links}
        counts = {sum(row["promotion_id"] == promo_id for row in links) for promo_id in ids}
        if len(ids) != expected_promotions or counts != {old_count}:
            raise ValueError(f"{scope}: unexpected orphaned promotion IDs or link count")
        groups[scope] = links
    if sum(map(len, groups.values())) != len(rows):
        raise ValueError("Orphan links exist outside the five reviewed import batches")
    return groups


def _current_stores(conn, scope: str) -> list[int]:
    if scope == "singhealth":
        query = """
            SELECT s.store_id FROM stores s
            JOIN customer_retailers cr ON cr.retailer_id = s.retailer_id
            JOIN customers c ON c.customer_id = cr.customer_id
            WHERE c.customer_name = 'singhealth' ORDER BY s.store_id
        """
        return list(conn.execute(text(query)).scalars())
    query = """
        SELECT s.store_id FROM stores s JOIN retailers r ON r.retailer_id = s.retailer_id
        WHERE r.retailer_name = :scope ORDER BY s.store_id
    """
    return list(conn.execute(text(query), {"scope": scope}).scalars())


def _snapshot(groups: dict[str, list[dict]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(("scope", "promotion_id", "old_store_id"))
    for scope, _, _, _, _ in GROUPS:
        for row in groups[scope]:
            writer.writerow((scope, row["promotion_id"], row["store_id"]))
    return output.getvalue().encode("utf-8")


def _store_snapshot(data: bytes) -> None:
    blob = storage.get_storage_client().bucket(storage.BUCKET_NAME).blob(SNAPSHOT_PATH)
    digest = hashlib.sha256(data).hexdigest()
    if blob.exists():
        if hashlib.sha256(blob.download_as_bytes()).hexdigest() != digest:
            raise ValueError("Existing GCS repair snapshot differs from current SQL links")
        return
    blob.metadata = {"sha256": digest, "source_database": "aireos"}
    blob.upload_from_string(data, content_type="text/csv", if_generation_match=0)


def _restore_prime(conn) -> None:
    conn.execute(text("INSERT INTO customers (customer_name) VALUES ('prime') ON CONFLICT DO NOTHING"))
    conn.execute(text("INSERT INTO retailers (retailer_name) VALUES ('prime_offline') ON CONFLICT DO NOTHING"))
    conn.execute(text("""
        INSERT INTO customer_retailers (customer_id, retailer_id)
        SELECT c.customer_id, r.retailer_id FROM customers c CROSS JOIN retailers r
        WHERE c.customer_name = 'prime' AND r.retailer_name = 'prime_offline'
        ON CONFLICT (retailer_id) DO NOTHING
    """))
    linked = conn.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM customer_retailers cr
            JOIN customers c ON c.customer_id = cr.customer_id
            JOIN retailers r ON r.retailer_id = cr.retailer_id
            WHERE c.customer_name = 'prime' AND r.retailer_name = 'prime_offline'
        )
    """)).scalar_one()
    if not linked:
        raise ValueError("prime_offline is linked to a different customer")
    conn.execute(text("""
        INSERT INTO stores (retailer_id, store_code, store_name, store_format)
        SELECT r.retailer_id, code, code, NULL
        FROM retailers r CROSS JOIN unnest(CAST(:codes AS text[])) AS input(code)
        WHERE r.retailer_name = 'prime_offline'
        ON CONFLICT (retailer_id, store_code) DO NOTHING
    """), {"codes": list(PRIME_CODES)})
    if len(_current_stores(conn, "prime_offline")) != len(PRIME_CODES):
        raise ValueError("Prime store catalog does not match the 14 reviewed outlet codes")


def _repair_group(conn, scope: str, links: list[dict]) -> None:
    ids = sorted({row["promotion_id"] for row in links})
    stores = _current_stores(conn, scope)
    if not stores:
        raise ValueError(f"No current stores for {scope}")
    existing = conn.execute(text("""
        SELECT COUNT(*) FROM promotion_stores ps JOIN stores s ON s.store_id = ps.store_id
        WHERE ps.promotion_id = ANY(CAST(:ids AS integer[]))
    """), {"ids": ids}).scalar_one()
    if existing:
        raise ValueError(f"{scope}: at least one promotion already has a valid store link")
    conn.execute(text("""
        DELETE FROM promotion_stores
        WHERE promotion_id = ANY(CAST(:ids AS integer[]))
    """), {"ids": ids})
    conn.execute(text("""
        INSERT INTO promotion_stores (promotion_id, store_id)
        SELECT promotion_id, store_id
        FROM unnest(CAST(:ids AS integer[])) AS p(promotion_id)
        CROSS JOIN unnest(CAST(:stores AS integer[])) AS s(store_id)
    """), {"ids": ids, "stores": stores})
    actual = conn.execute(text("""
        SELECT COUNT(*) FROM promotion_stores
        WHERE promotion_id = ANY(CAST(:ids AS integer[]))
    """), {"ids": ids}).scalar_one()
    if actual != len(ids) * len(stores):
        raise ValueError(f"{scope}: expected {len(ids) * len(stores)} links, found {actual}")
    print(f"REPAIRED {scope}: {len(ids)} promotions × {len(stores)} current stores", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Snapshot and repair the reviewed groups")
    args = parser.parse_args()
    if config.require("POSTGRESQL_INSTANCE_CONNECTION_NAME") != TARGET_INSTANCE:
        raise ValueError("Backend must point at the Singapore Cloud SQL instance")
    engine = sql.connect_with_connector()
    try:
        with engine.connect() as conn:
            if conn.execute(text("SELECT current_database()")).scalar_one() != "aireos":
                raise ValueError("Expected the Singapore aireos database")
            groups = _orphan_groups(conn)
            for scope, _, _, _, expected in GROUPS:
                current_count = len(_current_stores(conn, scope))
                print(f"READY {scope}: {expected} promotions, {len(groups[scope])} orphan links, {current_count} current stores")
            snapshot = _snapshot(groups)
        if not args.apply:
            print("Dry run complete. Pass --apply to save the audit snapshot and repair SQL.")
            return
        _store_snapshot(snapshot)
        with engine.begin() as conn:
            conn.execute(text("LOCK TABLE promotions, promotion_stores, stores IN SHARE ROW EXCLUSIVE MODE"))
            if _orphan_groups(conn) != groups:
                raise ValueError("Promotion links changed after the snapshot; aborting")
            _restore_prime(conn)
            for scope, _, _, _, _ in GROUPS:
                _repair_group(conn, scope, groups[scope])
            if conn.execute(text("""
                SELECT COUNT(*) FROM promotion_stores ps
                LEFT JOIN stores s ON s.store_id = ps.store_id WHERE s.store_id IS NULL
            """)).scalar_one():
                raise ValueError("Some orphan promotion-store links remain")
        print(f"COMMITTED; old links saved to gs://{storage.BUCKET_NAME}/{SNAPSHOT_PATH}")
    finally:
        sql.close_database()


if __name__ == "__main__":
    main()
