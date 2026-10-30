"""Import only manually approved calendar rows after catalog preflight."""

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.promotions import PromotionCreate  # noqa: E402
from app.services import promotion_service, sql  # noqa: E402
from app.services.promotion_pricing import mechanic_multiplier, voucher_multiplier  # noqa: E402


def _existing_keys(promotions: list[dict]) -> set[tuple]:
    keys = set()
    for promo in promotions:
        stores = promo.get("stores") or []
        skus = promo.get("skus") or []
        if isinstance(stores, str):
            stores = json.loads(stores)
        if isinstance(skus, str):
            skus = json.loads(skus)
        store_keys = tuple(sorted(
            (store["retailer"], str(store["store_code"])) for store in stores
        ))
        ranges = {sku["sku_range"] for sku in skus if sku.get("sku_range")}
        for sku_range in ranges:
            keys.add((
                tuple(sorted({store["retailer"] for store in stores})),
                str(promo["period_start"])[:10], str(promo["period_end"])[:10],
                promo["promo_type"], promo["promotion_mechanic"], promo["voucher"],
                sku_range, store_keys,
            ))
    return keys


def _candidate_key(row: dict, stores: list[dict]) -> tuple:
    return (
        tuple(sorted({store["retailer_name"] for store in stores})),
        row["period_start"], row["period_end"],
        row["promo_type"], row["promotion_mechanic"], row["voucher"],
        row["sku_range_proposal"], tuple(sorted(
            (store["retailer_name"], str(store["store_code"])) for store in stores
        )),
    )


def _catalog() -> tuple[dict[str, list[dict]], set[str]]:
    with sql.connect_with_connector_autocommit().connect() as conn:
        stores = conn.execute(text("""
            SELECT r.retailer_name, s.store_code, s.store_name, s.store_format
            FROM stores s JOIN retailers r ON r.retailer_id = s.retailer_id
            ORDER BY r.retailer_name, s.store_code
        """)).mappings().all()
        links = conn.execute(text("""
            SELECT c.customer_name, r.retailer_name
            FROM customers c
            JOIN customer_retailers cr ON cr.customer_id = c.customer_id
            JOIN retailers r ON r.retailer_id = cr.retailer_id
        """)).mappings().all()
        ranges = conn.execute(text("""
            SELECT DISTINCT sku_range FROM skus
            WHERE is_active = TRUE AND sku_range IS NOT NULL
              AND sku IS DISTINCT FROM sku_range
        """)).scalars().all()
    stores_by_scope = defaultdict(list)
    for store in stores:
        stores_by_scope[store["retailer_name"]].append(dict(store))
    for link in links:
        stores_by_scope[link["customer_name"]].extend(
            stores_by_scope[link["retailer_name"]]
        )
    return stores_by_scope, set(ranges)


def _payload(row: dict, stores: list[dict]) -> PromotionCreate:
    return PromotionCreate(
        stores=[{
            "retailer": store["retailer_name"],
            "store_name": store["store_name"],
            "store_code": str(store["store_code"]),
            "store_format": store["store_format"],
        } for store in stores],
        period_start=row["period_start"],
        period_end=row["period_end"],
        period_label=row["period_label"],
        promo_type=row["promo_type"],
        promotion_mechanic=row["promotion_mechanic"],
        voucher=row["voucher"],
        skus=[{
            "sku": row["sku_range_proposal"],
            "sku_range": row["sku_range_proposal"],
        }],
    )


def _load_review(path: Path) -> list[dict]:
    if path.suffix.casefold() != ".csv":
        return json.loads(path.read_text(encoding="utf-8"))
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        row["approved"] = row["approved"].strip().casefold() in {"true", "yes", "1"}
        row["issues"] = [part.strip() for part in row["issues"].split(";") if part.strip()]
        for field in ("voucher", "period_label", "sku_range_proposal"):
            row[field] = row[field].strip() or None
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review_file", type=Path, help="Reviewed CSV or JSON draft")
    parser.add_argument("--apply", action="store_true", help="Write approved, checked rows to Cloud SQL")
    args = parser.parse_args()
    rows = _load_review(args.review_file)
    approved = [row for row in rows if row.get("approved") is True]
    if not approved:
        print("No rows approved. Mark reviewed CSV or JSON rows, then run again.")
        return

    stores_by_scope, ranges = _catalog()
    existing = _existing_keys(promotion_service.get_promotions())
    ready = []
    blocked = []
    skipped = []
    concurrent = defaultdict(list)
    for row in approved:
        concurrent[(row["source"], row["sheet"], row["row"], row["promo_type"], row["retailer_proposal"])].append(row)

    for row in approved:
        source_ref = f'{row["source"]} / {row["sheet"]}:{row["row"]} {row["mechanic_column"]}'
        problems = list(row.get("issues") or [])
        if row["promo_type"].startswith("carton_"):
            problems.append("Carton mechanics are out of scope for this import")
        scope = row["retailer_proposal"]
        stores = stores_by_scope.get(scope, [])
        if not stores:
            problems.append("Customer/retailer or its stores are absent from the catalog")
        if row["sku_range_proposal"] not in ranges:
            problems.append("Proposed SKU range is absent from the active catalog")
        if mechanic_multiplier(row["promotion_mechanic"]) is None:
            problems.append("Mechanic cannot be priced")
        if voucher_multiplier(row["voucher"]) is None:
            problems.append("Voucher cannot be priced")
        if len(concurrent[(row["source"], row["sheet"], row["row"], row["promo_type"], scope)]) > 1:
            problems.append("Two mechanics for one row: approve only the intended offer")
        if problems:
            blocked.append((source_ref, problems))
            continue
        key = _candidate_key(row, stores)
        if key in existing:
            skipped.append(source_ref)
            continue
        if any(old[:-1] == key[:-1] for old in existing):
            blocked.append((source_ref, ["Existing matching offer covers a different store set"]))
            continue
        try:
            payload = _payload(row, stores)
        except ValueError as exc:
            blocked.append((source_ref, [str(exc)]))
            continue
        ready.append((source_ref, key, payload))
        existing.add(key)

    print(f"Approved: {len(approved)}; ready: {len(ready)}; already present: {len(skipped)}; blocked: {len(blocked)}")
    for source_ref, problems in blocked:
        print(f"  BLOCKED {source_ref}: {'; '.join(problems)}")
    if blocked:
        raise SystemExit("Resolve all blocked rows before importing any promotion.")
    if not args.apply:
        print("Dry run only. Add --apply after reviewing the ready rows.")
        return

    for source_ref, _, payload in ready:
        created = promotion_service.create_promotion(payload)
        print(f"  CREATED {source_ref}: promotion_id={created['promotion_id']}")


if __name__ == "__main__":
    try:
        main()
    finally:
        sql.close_database()
