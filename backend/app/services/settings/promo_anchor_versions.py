from datetime import date, datetime, timezone
from decimal import Decimal
from statistics import mean

from app.services.settings import common
from app.services.settings import promo_moment_rules as moment_rules
from app.services.settings import promo_uplift_rules as uplift_rules


# Pure rules for anchor VERSIONS (promo_anchor_settings.effective_from,
# migration 022): which anchor applies in which month, the anchor changes the
# official promotions already keyed in for the future will bring, and the
# uplift of a mechanic measured against the anchor version of the month it
# is for. No database here; promo_moments.py feeds these the rows it reads.
#
# - A moment is measured against the anchor version in effect in ITS month,
#   so a later version never changes the uplift of months it doesn't cover.
#   Its baseline is the SKU's average units in months at that version's
#   mechanic inside the version's own period (at least BASELINE_FROM of
#   them), else in every month at that mechanic (flagged "all_time").
# - The uplift for a mechanic under a version: the latest RECOMMEND_FROM
#   moments measured against that version; else the latest ones of any
#   version, each converted to this version's anchor (by how the old anchor
#   mechanic compares with the new one: measured if it can be, else the
#   placeholder rule; recorded); else the placeholder rule against this
#   version's anchor discount.
# - Planned moments (official promotions in months with no complete sales
#   yet) only ever count towards anchors, never towards an uplift.
#
# Every uplift comes back with what it was worked out from, so the pages can
# say exactly how a value was reached (the 'i' tooltip).


# ============================================================
# Constants
# ============================================================

# Anchor months a version needs in its own period before its baseline uses
# only them; fewer, and every month at that mechanic is used instead.
BASELINE_FROM = 3

# How an uplift was reached, most direct first.
ANCHOR = "anchor"                  # the mechanic is the anchor itself: 0%
MEASURED = "measured"              # latest moments, all against this version
MEASURED_EARLIER = "measured_earlier"  # uses earlier versions or an all-time baseline
PLACEHOLDER = "placeholder"        # too few moments: the placeholder rule
UNAVAILABLE = "unavailable"        # no moments and no discount to apply the rule to


# ============================================================
# ANCHOR VERSIONS
# ============================================================


def _version(row: dict) -> dict:
    return {
        "version_id": row["id"],
        "effective_from": row["effective_from"],
        "mechanic_key": uplift_rules.mechanic_key(row["promotion_mechanic"]),
        "mechanic_label": row["promotion_mechanic"],
        "anchor_pct": Decimal(row["anchor_pct"]),
    }


def version_lookup(anchor_rows: list[dict]):
    """
    anchor_for(customer_id, sku_range, month) over promo_anchor_settings rows
    (id, customer_id, sku_range, promotion_mechanic, anchor_pct,
    effective_from, updated_at): the version in effect that month, the
    range's own else its customer's. With neither, version_id is None and
    there is no mechanic (measuring then uses the group's most common one,
    as before versions), with the all-customers discount, else 20%.
    """

    by_month: dict[date, dict[tuple, dict]] = {}

    def saved_in(month: date) -> dict[tuple, dict]:
        if month not in by_month:
            by_month[month] = common.in_effect(
                anchor_rows, lambda row: (row["customer_id"], row["sku_range"]), month
            )
        return by_month[month]

    def anchor_for(customer_id: int, sku_range: str | None, month: date) -> dict:
        saved = saved_in(month)
        targets = [(customer_id, sku_range), (customer_id, None)] if sku_range else [(customer_id, None)]
        for target in targets:
            if target in saved:
                return _version(saved[target])

        default = saved.get((None, None))
        return {
            "version_id": None,
            "effective_from": None,
            "mechanic_key": None,
            "mechanic_label": None,
            "anchor_pct": Decimal(default["anchor_pct"]) if default else uplift_rules.FALLBACK_ANCHOR_PCT,
        }

    return anchor_for


# ============================================================
# PLANNED MOMENTS AND THE PROJECTED ANCHOR
# ============================================================


def find_planned_moments(promotions: list[dict], after: date | None) -> list[dict]:
    """
    Official promotions that will be moments once their sales are in: the
    same whole-month rule as find_moments, in months after `after` (the
    latest month with complete sales), without units. For anchors only.
    """

    planned = []
    for customer_id, sku, month, promotion, key in moment_rules.whole_month_promotions(promotions):
        if after is not None and month <= after:
            continue
        planned.append({
            "customer_id": customer_id,
            "sku": sku,
            "month": month,
            "promotion_id": promotion["promotion_id"],
            "mechanic_key": key,
            "mechanic_label": promotion["promotion_mechanic"],
            "planned": True,
        })
    return planned


def _next_month(month: date) -> date:
    return date(month.year + month.month // 12, month.month % 12 + 1, 1)


def _takes_over(anchor: dict, previous: str | None) -> bool:
    # A new mechanic takes over only with strictly more months in the window
    # than the one before it; a tie keeps the one before.
    new = anchor["mechanic_key"]
    if new is None or new == previous:
        return False
    return previous is None or anchor["counts"].get(new, 0) > anchor["counts"].get(previous, 0)


def project_anchors(
    moments: list[dict],
    planned: list[dict],
    sku_ranges: dict[str, str | None],
    this_month: date,
    targets: set[tuple[int, str | None]] | None = None,
) -> dict[tuple[int, str | None], list[dict]]:
    """
    The anchor changes the official promotions already keyed in will bring,
    per customer x SKU range and per customer (sku_range None; only `targets`
    when given): for each month after `this_month` up to the target's last
    planned moment, the anchor_counts rule over real and planned moments in
    the 12 months up to it. It starts from what that rule says as of this
    month, so a mechanic the sales already point to (shown as Recommended,
    adopted by hand) is never saved as a projected change; only shifts the
    future promotions bring are. A mechanic takes over only with strictly
    more months than the one before it, and a month with too few moments to
    say changes nothing. Each change has effective_from, mechanic_key,
    mechanic_label, months, window_months and counts.
    """

    horizons: dict[tuple[int, str | None], date] = {}
    for moment in planned:
        if moment["month"] <= this_month:
            continue
        sku_range = sku_ranges.get(moment["sku"])
        moment_targets = [(moment["customer_id"], None)] + ([(moment["customer_id"], sku_range)] if sku_range else [])
        for target in moment_targets:
            if targets is None or target in targets:
                horizons[target] = max(horizons.get(target, moment["month"]), moment["month"])
    if not horizons:
        return {}

    everything = moments + planned
    as_of_now = moment_rules.anchor_counts(everything, sku_ranges, this_month)
    previous = {target: (as_of_now.get(target) or {}).get("mechanic_key") for target in horizons}
    changes: dict[tuple[int, str | None], list[dict]] = {target: [] for target in horizons}

    month = _next_month(this_month)
    while month <= max(horizons.values()):
        counted = moment_rules.anchor_counts(everything, sku_ranges, month)
        for target, horizon in horizons.items():
            anchor = counted.get(target)
            if month > horizon or anchor is None or not _takes_over(anchor, previous[target]):
                continue
            changes[target].append({"effective_from": month, **anchor})
            previous[target] = anchor["mechanic_key"]
        month = _next_month(month)

    return {target: items for target, items in changes.items() if items}


# ============================================================
# MEASURING AGAINST EACH MONTH'S VERSION
# ============================================================


def measure_by_version(moments: list[dict], sku_ranges: dict[str, str | None], anchor_for) -> list[dict]:
    """
    Each moment measured against the anchor version of its own month
    (anchor_for from version_lookup): version_id, version_from,
    baseline_mechanic_key, baseline_units, baseline_source ("version": that
    version's own months, "all_time": every month at the mechanic, None: no
    baseline), baseline_months, is_baseline and uplift_pct. A version with
    no mechanic of its own measures the group against its most common one;
    a typed anchor discount has no baseline.
    """

    by_group: dict[tuple[int, str], list[dict]] = {}
    for moment in moments:
        group = sku_ranges.get(moment["sku"]) or moment["sku"]
        by_group.setdefault((moment["customer_id"], group), []).append(moment)

    measured = []
    for group_moments in by_group.values():
        versions = [anchor_for(m["customer_id"], sku_ranges.get(m["sku"]), m["month"]) for m in group_moments]
        most_common = moment_rules._baseline_key(group_moments)

        for moment, version in zip(group_moments, versions):
            key = version["mechanic_key"] if version["version_id"] is not None else most_common
            at_key = [
                (other, other_version)
                for other, other_version in zip(group_moments, versions)
                if other["sku"] == moment["sku"] and other["mechanic_key"] == key
            ]
            own = [other for other, other_version in at_key if other_version["version_id"] == version["version_id"]]

            base, source = [], None
            if key is not None and len(own) >= BASELINE_FROM:
                base, source = own, "version"
            elif key is not None and at_key:
                base, source = [other for other, _ in at_key], "all_time"

            baseline_units = mean(other["units"] for other in base) if base else None
            uplift = round((moment["units"] / baseline_units - 1) * 100, 2) if baseline_units else None
            measured.append({
                **moment,
                "version_id": version["version_id"],
                "version_from": version["effective_from"],
                "baseline_mechanic_key": key,
                "baseline_units": round(baseline_units, 2) if baseline_units is not None else None,
                "baseline_source": source,
                "baseline_months": sorted(other["month"] for other in base),
                "is_baseline": moment["mechanic_key"] == key,
                "uplift_pct": uplift,
            })

    return sorted(measured, key=lambda m: (m["customer_id"], m["sku"], m["month"]))


# ============================================================
# CHOOSING AN UPLIFT
# ============================================================


def _latest(rows: list[dict], count: int = moment_rules.RECOMMEND_FROM) -> list[dict]:
    return sorted(rows, key=lambda m: m["month"])[-count:]


def _anchor_key(rows: list[dict], version: dict) -> str | None:
    # The mechanic a version measures against: its own, or for a version
    # with none, the most common one measuring picked for its moments.
    if version["version_id"] is not None:
        return version["mechanic_key"]
    return next((m["baseline_mechanic_key"] for m in rows if m["version_id"] is None), None)


def _relation(rows: list[dict], from_key: str, version: dict, anchor_key: str | None, discount_for) -> dict | None:
    """How a moment's old anchor mechanic compares with this version's anchor, as an uplift %."""

    if from_key == anchor_key:
        return {"pct": 0.0, "source": "same_anchor"}

    against_version = [
        m for m in rows
        if m["mechanic_key"] == from_key and m["version_id"] == version["version_id"] and m["uplift_pct"] is not None
    ]
    if len(against_version) >= moment_rules.RECOMMEND_FROM:
        latest = _latest(against_version)
        return {
            "pct": round(mean(m["uplift_pct"] for m in latest), 2),
            "source": "measured",
            "months": [m["month"] for m in latest],
        }

    discount = discount_for(from_key) if from_key else None
    if discount is None:
        return None
    return {"pct": float(uplift_rules.placeholder_uplift(discount, version["anchor_pct"])), "source": "placeholder"}


def _moment_used(moment: dict, used_pct: float, relation: dict | None) -> dict:
    return {
        "month": moment["month"],
        "uplift_pct": moment["uplift_pct"],
        "used_pct": used_pct,
        "version_id": moment["version_id"],
        "baseline_source": moment["baseline_source"],
        "baseline_months": moment["baseline_months"],
        "converted": relation,
    }


def choose_uplift(measured: list[dict], mechanic_key: str, version: dict, discount_for) -> dict:
    """
    The uplift of `mechanic_key` for one customer x SKU under one anchor
    version (`measured` from measure_by_version, already that customer x
    SKU's moments; `discount_for(mechanic_key)` its effective discount or
    None). Returns level, uplift_pct, the anchor, the moments used (with any
    conversion) and the placeholder inputs, so the value can be traced.
    """

    anchor_key = _anchor_key(measured, version)
    result = {
        "mechanic_key": mechanic_key,
        "anchor": {
            "version_id": version["version_id"],
            "effective_from": version["effective_from"],
            "mechanic_key": anchor_key,
            "anchor_pct": float(version["anchor_pct"]),
        },
        "moments": [],
        "placeholder": None,
    }
    if mechanic_key == anchor_key:
        return {**result, "level": ANCHOR, "uplift_pct": 0.0}

    of_mechanic = [m for m in measured if m["mechanic_key"] == mechanic_key and m["uplift_pct"] is not None]

    own = [m for m in of_mechanic if m["version_id"] == version["version_id"]]
    if len(own) >= moment_rules.RECOMMEND_FROM:
        latest = _latest(own)
        all_own_baseline = all(m["baseline_source"] != "all_time" for m in latest)
        return {
            **result,
            "level": MEASURED if all_own_baseline else MEASURED_EARLIER,
            "uplift_pct": round(mean(m["uplift_pct"] for m in latest), 2),
            "moments": [_moment_used(m, m["uplift_pct"], None) for m in latest],
        }

    usable = []
    for moment in sorted(of_mechanic, key=lambda m: m["month"], reverse=True):
        if moment["version_id"] == version["version_id"]:
            usable.append(_moment_used(moment, moment["uplift_pct"], None))
        else:
            relation = _relation(measured, moment["baseline_mechanic_key"], version, anchor_key, discount_for)
            if relation is None:
                continue
            converted = ((1 + moment["uplift_pct"] / 100) * (1 + relation["pct"] / 100) - 1) * 100
            usable.append(_moment_used(moment, round(converted, 2), relation))
        if len(usable) == moment_rules.RECOMMEND_FROM:
            break

    if len(usable) == moment_rules.RECOMMEND_FROM:
        usable.reverse()
        return {
            **result,
            "level": MEASURED_EARLIER,
            "uplift_pct": round(mean(m["used_pct"] for m in usable), 2),
            "moments": usable,
        }

    discount = discount_for(mechanic_key)
    if discount is None:
        return {**result, "level": UNAVAILABLE, "uplift_pct": None}
    return {
        **result,
        "level": PLACEHOLDER,
        "uplift_pct": float(uplift_rules.placeholder_uplift(discount, version["anchor_pct"])),
        "placeholder": {"discount_pct": float(discount), "anchor_pct": float(version["anchor_pct"])},
    }


# ============================================================
# WHAT A RECALCULATION SAVES (promo_recalc)
# ============================================================

# Rows not yet saved sort after every saved one when picking what is in
# effect, as the next save would.
_NOT_SAVED_YET = datetime.max.replace(tzinfo=timezone.utc)


def projected_to_save(
    anchor_rows: list[dict],
    changes: dict[tuple[int, str | None], list[dict]],
    customer_id: int,
    this_month: date,
    discounts: dict[str, dict],
) -> tuple[list[dict], list[str]]:
    """
    The 'projected' anchor rows to add so one customer's saved timeline from
    next month on follows `changes` (project_anchors), and warnings. The
    customer comes before its ranges, so a range that follows its customer
    needs no row of its own. A projected change that no longer holds is
    undone by a row restating the anchor before it. Nothing is written from
    the month of a manual or recommended row saved for a later month (an
    edit of an upcoming anchor wins), or for a mechanic with no discount
    (`discounts`: {mechanic_key: {label, discount_pct}}).
    """

    future = [
        row for row in anchor_rows
        if row["customer_id"] == customer_id and row["effective_from"] and row["effective_from"] > this_month
    ]
    targets = set(changes) | {(customer_id, row["sku_range"]) for row in future if row["source"] == "projected"}
    months = sorted(
        {change["effective_from"] for items in changes.values() for change in items}
        | {row["effective_from"] for row in future if row["source"] == "projected"}
    )

    inserts: list[dict] = []
    warnings: list[str] = []
    for target in sorted(targets, key=lambda t: (t[1] is not None, t[1] or "")):
        sku_range = target[1]
        pinned = [
            row["effective_from"] for row in future
            if row["sku_range"] == sku_range and row["source"] != "projected"
        ]
        pinned_from = min(pinned) if pinned else None
        start = version_lookup(anchor_rows)(customer_id, sku_range, this_month)["mechanic_key"]

        for month in months:
            if pinned_from is not None and month >= pinned_from:
                continue
            desired = start
            for change in changes.get(target, []):
                if change["effective_from"] <= month:
                    desired = change["mechanic_key"]

            saved_rows = anchor_rows + [
                {**row, "id": -index - 1, "updated_at": _NOT_SAVED_YET} for index, row in enumerate(inserts)
            ]
            if desired is None or desired == version_lookup(saved_rows)(customer_id, sku_range, month)["mechanic_key"]:
                continue

            mechanic = discounts.get(desired)
            if mechanic is None or mechanic.get("discount_pct") is None:
                warnings.append(
                    f"Anchor {desired} from {month.isoformat()} not saved: the mechanic has no discount in Promotion Uplift Settings."
                )
                continue
            inserts.append({
                "customer_id": customer_id,
                "sku_range": sku_range,
                "promotion_mechanic": mechanic["label"],
                "anchor_pct": Decimal(mechanic["discount_pct"]),
                "source": "projected",
                "effective_from": month,
            })
    return inserts, warnings


def uplifts_to_save(
    measured: list[dict],
    customer_id: int,
    sku_ranges: dict[str, str | None],
    anchor_for,
    months: list[date],
    discount_for,
) -> list[dict]:
    """
    One choose_uplift per SKU x mechanic with measured moments x anchor
    version in effect in any of `months` (this month and every later month a
    version starts). Mechanics with no moments are left out: the placeholder
    rule is worked out on read.
    """

    by_sku: dict[str, list[dict]] = {}
    for moment in measured:
        if moment["customer_id"] == customer_id:
            by_sku.setdefault(moment["sku"], []).append(moment)

    rows = []
    for sku, sku_moments in sorted(by_sku.items()):
        mechanics = sorted({m["mechanic_key"] for m in sku_moments if m["uplift_pct"] is not None})
        sku_versions = {}
        for month in months:
            version = anchor_for(customer_id, sku_ranges.get(sku), month)
            sku_versions.setdefault(version["version_id"], version)
        for mechanic_key in mechanics:
            for version in sku_versions.values():
                rows.append({
                    "customer_id": customer_id,
                    "sku": sku,
                    **choose_uplift(sku_moments, mechanic_key, version, discount_for),
                })
    return rows
