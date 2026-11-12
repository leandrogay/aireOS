"""Pure budget maths: Initial plus growth/blocks, with promotions replacing carried effects."""

import calendar
import math
from collections import defaultdict
from datetime import date


def _covers(item: dict, row: dict) -> bool:
    names = item.get("customer_names")
    ranges = item.get("sku_ranges")
    return (
        (not names or row["customer_name"] in names)
        and (not ranges or row.get("sku_range") in ranges)
        and (not item.get("sku") or item["sku"] == row["sku"])
        and item["start_month"] <= row["month_year"] <= item["end_month"]
        and not any(pair["customer_name"] == row["customer_name"] and pair.get("sku_range") == row.get("sku_range")
                    for pair in item.get("excluded_pairs", []))
    )


def _promotion_share(item: dict, row: dict) -> float:
    if not item.get("start_date") or not item.get("end_date"):
        return 1
    month = date.fromisoformat(row["month_year"])
    days = calendar.monthrange(month.year, month.month)[1]
    first = max(month, date.fromisoformat(item["start_date"]))
    last = min(month.replace(day=days), date.fromisoformat(item["end_date"]))
    return max(0, (last - first).days + 1) / days


def _promotion_pct(item: dict, row: dict) -> float:
    refs = item.get("references_by_customer", {}).get(row["customer_name"], item)
    mechanic = item.get("override_uplift_pct")
    if mechanic is None:
        mechanic = refs.get("reference_by_sku", {}).get(row["product_name"], refs["reference_uplift_pct"])
    voucher = refs.get("voucher_by_sku", {}).get(row["product_name"], refs.get("voucher_uplift_pct", 0)) if item["voucher"] else 0
    return (float(mechanic) + float(voucher)) * _promotion_share(item, row)


def calculate_budget(
    rows: list[dict], blocks: list[dict], promotions: list[dict], year: int,
    split_rows: list[dict] | None = None,
) -> list[dict]:
    """Freeze every Initial customer x SKU x month for one full year, never chart-filtered rows."""
    base = [dict(row) for row in rows if row.get("forecast_initial") is not None and row["month_year"].startswith(f"{year}-")]
    if not base:
        raise ValueError(f"No Initial Yearly Forecast exists for {year} yet.")
    groups = defaultdict(list)
    for row in base:
        if not math.isfinite(float(row["forecast_initial"])) or row["forecast_initial"] < 0:
            raise ValueError("Initial contains invalid units; refresh the forecast before locking.")
        groups[(row["customer_id"], row["sku"])].append(row["month_year"])
    expected = {f"{year}-{month:02d}-01" for month in range(1, 13)}
    if any(len(months) != 12 or set(months) != expected for months in groups.values()):
        raise ValueError("Initial must cover January through December for every included customer and SKU before locking.")
    split_index = {(row["customer_id"], row["sku"], row["month_year"]): row for row in split_rows or []}
    for row in base:
        split = split_index.get((row["customer_id"], row["sku"], row["month_year"]))
        if split is None or not all(math.isfinite(float(split[key])) for key in ("tier0", "baseline", "carried")) or split["baseline"] < 0:
            raise ValueError("Initial's baseline and carried promotion effects must be available for every cell before locking.")
        if abs(split["tier0"] - row["forecast_initial"]) > 1e-6 or abs(split["baseline"] + split["carried"] - row["forecast_initial"]) > 1e-6:
            raise ValueError("Initial's breakdown no longer matches its published units; reload before locking.")
    deltas = [0.0] * len(base)
    for block in blocks:
        if not block["is_active"]:
            continue
        covered = defaultdict(list)
        for index, row in enumerate(base):
            if _covers(block, row):
                covered[row["customer_id"]].append(index)
        for indices in covered.values():
            total = sum(base[index]["forecast_initial"] for index in indices)
            for index in indices:
                units = base[index]["forecast_initial"]
                share = units / 100 if block["uplift_mode"] == "pct" else units / total if total else 1 / len(indices)
                deltas[index] += float(block["uplift_value"]) * share
    replaced_share = [0.0] * len(base)
    for item in promotions:
        if item["is_active"]:
            for index, row in enumerate(base):
                if _covers(item, row):
                    split = split_index[(row["customer_id"], row["sku"], row["month_year"])]
                    deltas[index] += split["baseline"] * _promotion_pct(item, row) / 100
                    replaced_share[index] += _promotion_share(item, row)
    for index, row in enumerate(base):
        split = split_index[(row["customer_id"], row["sku"], row["month_year"])]
        deltas[index] -= split["carried"] * min(1, replaced_share[index])
    return [{**row, "units": max(0, row["forecast_initial"] + deltas[index])} for index, row in enumerate(base)]
