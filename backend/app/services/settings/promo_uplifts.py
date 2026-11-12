from datetime import date
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.settings import common
from app.services.settings import promo_moment_rules as moment_rules
from app.services.settings import promo_moments
from app.services.settings import promo_recalc_events
from app.services.settings import promo_uplift_rules as rules
from app.services.settings.common import CustomerNotFoundError


# Promotion Uplift Settings: the uplift per promotion mechanic
# (promo_uplift_settings) and the ordinary-month mechanic placeholder uplifts
# are measured from, the "anchor" (promo_anchor_settings), per customer x SKU
# range, per customer and for all customers.
#
# Both tables are append-only, like doh_settings: a change inserts a row and
# the newest row for a target (updated_at, then id) is its current value.
# The tables hold one row per change, so each read loads every version and
# the current ones are picked here (common.newest), which keeps the SQL plain.
# Writes lock the table first, so two saves never interleave. The rules
# themselves are pure and live in promo_uplift_rules.py.


# ============================================================
# Custom Exceptions
# ============================================================


class MechanicNotFoundError(Exception):
    pass


class UpliftSettingConflictError(Exception):
    pass


# ============================================================
# Constants
# ============================================================

# Who a change is recorded as when no one is named: the routers always pass
# the signed-in user's email, so this is only for calls from scripts.
DEFAULT_CHANGED_BY = "aireos"

# Most specific first: the scope a mechanic's value is taken from.
_SCOPE_ORDER = ("sku", "range", "customer", "all")


def _num(value) -> float | None:
    return float(value) if value is not None else None


def _lock(conn: Connection, table: str) -> None:
    # Readers are not blocked; a second writer waits for this transaction.
    # `table` is one of the two settings tables, never user input.
    conn.execute(text(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE"))


# ============================================================
# READS SHARED BY SEVERAL ENDPOINTS
# ============================================================


def _customer_by_name(conn: Connection, customer_name: str) -> dict:
    row = conn.execute(
        text(
            """
            SELECT
                customer_id,
                customer_name

            FROM customers

            WHERE
                customer_name = :customer_name
            """
        ),
        {"customer_name": customer_name},
    ).mappings().first()

    if row is None:
        raise CustomerNotFoundError(f"Customer {customer_name} does not exist.")
    return dict(row)


def _customers(conn: Connection, customer_id: int | None = None) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                customer_id,
                customer_name

            FROM customers

            WHERE
                CAST(:customer_id AS integer) IS NULL
                OR customer_id = CAST(:customer_id AS integer)

            ORDER BY
                customer_name ASC
            """
        ),
        {"customer_id": customer_id},
    ).mappings().all()

    if customer_id is not None and not rows:
        raise CustomerNotFoundError(f"Customer {customer_id} does not exist.")
    return [dict(row) for row in rows]


def _products(conn: Connection) -> list[dict]:
    # Same exclusion as catalog_service.get_skus: rows whose sku equals
    # sku_range are leftover range-name inserts, not products.
    rows = conn.execute(
        text(
            """
            SELECT
                product_name,
                sku,
                sku_range

            FROM skus

            WHERE
                product_name IS NOT NULL
                AND sku IS DISTINCT FROM sku_range
            """
        )
    ).mappings().all()

    return [dict(row) for row in rows]


def _ranges(conn: Connection) -> list[str]:
    rows = conn.execute(
        text(
            """
            SELECT DISTINCT
                sku_range

            FROM skus

            WHERE
                is_active
                AND sku_range IS NOT NULL
                AND sku IS DISTINCT FROM sku_range

            ORDER BY
                sku_range ASC
            """
        )
    ).all()

    return [row[0] for row in rows]


# ============================================================
# ANCHOR (ordinary-month mechanic)
#
# A customer x SKU range's anchor is the mechanic it most often runs as a
# moment (promo_moments.anchor_recommendations), saved once and never
# recalculated by itself: someone adopts a newer recommendation when the
# usual mechanic shifts. Its discount is what placeholder uplifts are
# measured from. Only where there are too few moments to recommend from
# (fewer than RECOMMEND_FROM months in the window) can a discount be typed
# in instead ('manual'). A range with nothing saved uses its customer's
# anchor, a customer the all-customers value, else 20%.
#
# Each version applies from a month (effective_from, migration 019; NULL =
# from the start), so a change already decided for the future is saved
# ahead without moving the months before it. The anchor shown is the one in
# effect this month; `upcoming` lists the later changes.
# ============================================================


def _anchor_rows(conn: Connection) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                anchor_id AS id,
                customer_id,
                sku_range,
                promotion_mechanic,
                anchor_pct,
                source,
                effective_from,
                updated_by,
                updated_at

            FROM promo_anchor_settings
            """
        )
    ).mappings().all()

    return [dict(row) for row in rows]


def _anchor_target(row: dict) -> tuple:
    return (row["customer_id"], row["sku_range"])


def _current_anchors(anchor_rows: list[dict], month: date | None = None) -> dict[tuple, dict]:
    """The rows in effect in `month` (this month when not given), per customer x range."""

    return common.in_effect(anchor_rows, _anchor_target, month or common.this_month())


def _anchors_by_month(anchor_rows: list[dict], month: date) -> list[tuple[date, dict[tuple, dict]]]:
    """The rows in effect from each later month a version starts in, oldest first."""

    starts = sorted({row["effective_from"] for row in anchor_rows if row["effective_from"] and row["effective_from"] > month})
    return [(start, _current_anchors(anchor_rows, start)) for start in starts]


def _default_anchor(current: dict[tuple, dict]) -> Decimal:
    row = current.get((None, None))
    return Decimal(row["anchor_pct"]) if row is not None else rules.FALLBACK_ANCHOR_PCT


def _recommended_view(recommendation: dict | None, current: list[dict]) -> dict | None:
    """The recommendation with the mechanic's standard label and discount from its all-customers uplift row."""

    if recommendation is None or recommendation["mechanic_key"] is None:
        return None
    key = recommendation["mechanic_key"]
    base = next((row for row in current if row["scope"] == "all" and row["mechanic_key"] == key), None)
    return {
        "mechanic_key": key,
        "mechanic_label": base["promotion_mechanic"] if base else recommendation["mechanic_label"],
        "anchor_pct": _num(base["effective_discount_pct"]) if base else None,
        "months": recommendation["months"],
    }


def _anchor_values(saved: dict[tuple, dict], customer_id: int, sku_range: str | None) -> dict:
    """
    A target's anchor among `saved` (the rows in effect in one month): its
    own row, else a range takes its customer's ('customer') and a customer
    the all-customers value ('default').
    """

    row = saved.get((customer_id, sku_range))
    if row is not None:
        return {
            "anchor_pct": _num(row["anchor_pct"]),
            "mechanic_key": rules.mechanic_key(row["promotion_mechanic"]),
            "mechanic_label": row["promotion_mechanic"],
            "source": row["source"],
            "effective_from": row["effective_from"].isoformat() if row["effective_from"] else None,
            "changed_by": row["updated_by"],
            "changed_at": common.iso(row["updated_at"]),
        }

    if sku_range is not None:
        inherited = _anchor_values(saved, customer_id, None)
        fallback = {key: inherited[key] for key in ("anchor_pct", "mechanic_key", "mechanic_label")}
        source = "customer"
    else:
        fallback = {"anchor_pct": _num(_default_anchor(saved)), "mechanic_key": None, "mechanic_label": None}
        source = "default"
    return {**fallback, "source": source, "effective_from": None, "changed_by": None, "changed_at": None}


def _upcoming(
    values: dict,
    later: list[tuple[date, dict[tuple, dict]]],
    customer_id: int,
    sku_range: str | None,
) -> list[dict]:
    """The months after this one where a target's anchor changes, and what it changes to."""

    changes = []
    previous = values
    for start, saved in later:
        values = _anchor_values(saved, customer_id, sku_range)
        if (values["anchor_pct"], values["mechanic_key"]) != (previous["anchor_pct"], previous["mechanic_key"]):
            changes.append({**values, "effective_from": start.isoformat()})
        previous = values
    return changes


def _anchor_entry(
    values: dict,
    upcoming: list[dict],
    recommendation: dict | None,
    current: list[dict],
    options: list[dict],
) -> dict:
    window_months = recommendation["window_months"] if recommendation else 0
    recommended = _recommended_view(recommendation, current)
    return {
        **values,
        "upcoming": upcoming,
        "recommended": recommended,
        "window_months": window_months,
        # What an overwrite can pick (overwrite_anchor).
        "mechanic_options": options,
        "recommendation_differs": recommended is not None and (
            values["source"] != "recommended" or recommended["mechanic_key"] != values["mechanic_key"]
        ),
    }


def _target_view(
    saved: dict[tuple, dict],
    later: list[tuple[date, dict[tuple, dict]]],
    customer_id: int,
    sku_range: str | None,
    recommendations: dict[tuple, dict],
    current: list[dict],
    options: dict[tuple, list[dict]],
) -> dict:
    values = _anchor_values(saved, customer_id, sku_range)
    upcoming = _upcoming(values, later, customer_id, sku_range)
    return _anchor_entry(
        values,
        upcoming,
        recommendations.get((customer_id, sku_range)),
        current,
        options.get((customer_id, sku_range), []),
    )


def _anchor_view(
    customer: dict,
    saved: dict[tuple, dict],
    later: list[tuple[date, dict[tuple, dict]]],
    ranges: list[str],
    recommendations: dict[tuple, dict],
    current: list[dict],
    options: dict[tuple, list[dict]],
) -> dict:
    customer_id = customer["customer_id"]
    range_views = [
        {"sku_range": sku_range, **_target_view(saved, later, customer_id, sku_range, recommendations, current, options)}
        for sku_range in ranges
    ]

    return {
        "customer_id": customer_id,
        "customer_name": customer["customer_name"],
        **_target_view(saved, later, customer_id, None, recommendations, current, options),
        "default_anchor_pct": _num(_default_anchor(saved)),
        "ranges": range_views,
    }


def _anchors(conn: Connection, customer_id: int | None = None, with_recommendations: bool = True) -> list[dict]:
    # Recommendations read every customer's sell-out, so resolve_uplifts,
    # which only needs the saved anchors, leaves them out.
    customers = _customers(conn, customer_id)
    rows = _anchor_rows(conn)
    month = common.this_month()
    saved = _current_anchors(rows, month)
    later = _anchors_by_month(rows, month)
    current = _current_uplifts(_uplift_rows(conn))
    ranges = _ranges(conn)
    recommendations = promo_moments.anchor_recommendations(conn) if with_recommendations else {}
    options = _mechanic_options(conn, current) if with_recommendations else {}

    return [_anchor_view(customer, saved, later, ranges, recommendations, current, options) for customer in customers]


def _mechanic_options(conn: Connection, current: list[dict]) -> dict[tuple, list[dict]]:
    """
    Per customer x SKU range (and per customer, sku_range None): the
    mechanics its official whole-month promotions use (promo_moment_calc,
    real and planned) that have a discount, so an overwrite can pick one.
    A mechanic nobody has run yet is added on the Promotions page first.
    """

    rows = conn.execute(
        text(
            """
            SELECT DISTINCT
                m.customer_id,
                s.sku_range,
                m.mechanic_key

            FROM promo_moment_calc m
            JOIN skus s
                ON s.sku = m.sku
            """
        )
    ).mappings().all()

    discounts = _discount_by_key(current)
    labels = {row["mechanic_key"]: row["promotion_mechanic"] for row in current if row["scope"] == "all"}
    used: dict[tuple, set[str]] = {}
    for row in rows:
        if row["mechanic_key"] not in discounts:
            continue
        used.setdefault((row["customer_id"], None), set()).add(row["mechanic_key"])
        if row["sku_range"]:
            used.setdefault((row["customer_id"], row["sku_range"]), set()).add(row["mechanic_key"])

    return {
        target: [
            {"mechanic_key": key, "mechanic_label": labels[key], "anchor_pct": _num(discounts[key])}
            for key in sorted(keys, key=lambda key: (discounts[key], key))
        ]
        for target, keys in used.items()
    }


def _anchor_pct_for(anchor: dict, sku_range: str | None) -> Decimal:
    # A product's range anchor; the customer's for all SKUs or a range the
    # catalogue no longer lists.
    for item in anchor["ranges"]:
        if item["sku_range"] == sku_range:
            return Decimal(str(item["anchor_pct"]))
    return Decimal(str(anchor["anchor_pct"]))


def _fallback_view(anchor_rows: list[dict]) -> dict:
    """The anchor every target without its own (or its customer's) uses: one setting, versioned by month."""

    month = common.this_month()
    values = _anchor_values(_current_anchors(anchor_rows, month), None, None)
    return {**values, "upcoming": _upcoming(values, _anchors_by_month(anchor_rows, month), None, None)}


def list_anchors() -> dict:
    """Every customer's anchor and each of its ranges', with what the data recommends now, plus the fallback."""

    with common.read_connection() as conn:
        customers = _anchors(conn)
        anchor_rows = _anchor_rows(conn)

    fallback = _fallback_view(anchor_rows)
    return {
        "default_anchor_pct": fallback["anchor_pct"],
        "fallback": fallback,
        "recommend_from": moment_rules.RECOMMEND_FROM,
        "window_months": moment_rules.ANCHOR_WINDOW_MONTHS,
        "customers": customers,
    }


def get_anchor(customer_id: int) -> dict:
    with common.read_connection() as conn:
        return _anchors(conn, customer_id)[0]


def _insert_anchor(conn: Connection, values: dict) -> None:
    conn.execute(
        text(
            """
            INSERT INTO promo_anchor_settings (
                customer_id,
                sku_range,
                promotion_mechanic,
                anchor_pct,
                source,
                effective_from,
                updated_by
            )
            VALUES (
                CAST(:customer_id AS integer),
                :sku_range,
                :promotion_mechanic,
                CAST(:anchor_pct AS numeric(5, 2)),
                :source,
                CAST(:effective_from AS date),
                :updated_by
            )
            """
        ),
        values,
    )
    if values["source"] != "projected":
        customer_ids = [values["customer_id"]] if values["customer_id"] is not None else None
        promo_recalc_events.record_customers(conn, "anchor_change", customer_ids, "promo_anchor_settings")


def _check_anchor_target(conn: Connection, customer_id: int | None, sku_range: str | None) -> None:
    if customer_id is not None:
        common.lock_customer(conn, customer_id)
    if sku_range is None:
        return
    if customer_id is None:
        raise ValueError("A SKU range anchor belongs to one customer.")
    if sku_range not in _ranges(conn):
        raise ValueError(f"SKU range {sku_range} is not in the catalogue.")


def _target_entry(conn: Connection, customer_id: int, sku_range: str | None) -> dict:
    anchor = _anchors(conn, customer_id)[0]
    if sku_range is None:
        return anchor
    return next(item for item in anchor["ranges"] if item["sku_range"] == sku_range)


def set_fallback_anchor(anchor_pct: Decimal, updated_by: str | None = None) -> dict:
    """
    Type the fallback anchor: the discount of an ordinary month for every
    customer x SKU range with no anchor of its own or its customer's. It
    applies from this month; earlier months keep the value they had.
    `changed` is False when it already is that value.
    """

    with common.get_engine().begin() as conn:
        _lock(conn, "promo_anchor_settings")

        current = _current_anchors(_anchor_rows(conn)).get((None, None))
        changed = current is None or Decimal(current["anchor_pct"]) != Decimal(anchor_pct)
        if changed:
            _insert_anchor(conn, {
                "customer_id": None,
                "sku_range": None,
                "promotion_mechanic": None,
                "anchor_pct": anchor_pct,
                "source": "manual",
                "effective_from": common.this_month(),
                "updated_by": updated_by or DEFAULT_CHANGED_BY,
            })
        fallback = _fallback_view(_anchor_rows(conn))

    promo_recalc_events.enqueue_best_effort(changed and promo_recalc_events.enabled())
    return {"changed": changed, "fallback": fallback}


def overwrite_anchor(
    customer_id: int,
    mechanic_key: str,
    sku_range: str | None = None,
    updated_by: str | None = None,
) -> dict:
    """
    Overwrite a customer's (or one of its SKU ranges') anchor with a
    mechanic its official promotions already use, from this month on. Its
    discount comes from the mechanic. Projected changes later on still
    apply. `changed` is False when it is already that overwrite.
    """

    with common.get_engine().begin() as conn:
        _check_anchor_target(conn, customer_id, sku_range)
        _lock(conn, "promo_anchor_settings")

        entry = _target_entry(conn, customer_id, sku_range)
        option = next((item for item in entry["mechanic_options"] if item["mechanic_key"] == mechanic_key), None)
        if option is None:
            raise ValueError(
                "Only mechanics used in official promotions for this customer and SKU range can be anchors. "
                "Add a promotion with this mechanic on the Promotions page first."
            )

        current = _current_anchors(_anchor_rows(conn)).get((customer_id, sku_range))
        changed = not (
            current is not None
            and current["source"] == "manual"
            and rules.mechanic_key(current["promotion_mechanic"]) == mechanic_key
        )
        if changed:
            _insert_anchor(conn, {
                "customer_id": customer_id,
                "sku_range": sku_range,
                "promotion_mechanic": option["mechanic_label"],
                "anchor_pct": Decimal(str(option["anchor_pct"])),
                "source": "manual",
                "effective_from": common.this_month(),
                "updated_by": updated_by or DEFAULT_CHANGED_BY,
            })
        anchor = _anchors(conn, customer_id)[0]

    promo_recalc_events.enqueue_best_effort(changed and promo_recalc_events.enabled())
    return {"changed": changed, "anchor": anchor}


def _adopt_values(entry: dict, customer_id: int, sku_range: str | None, updated_by: str) -> dict:
    recommended = entry["recommended"]
    if recommended is None:
        raise UpliftSettingConflictError("Too few moments to recommend an anchor; pick a mechanic instead")
    if recommended["anchor_pct"] is None:
        raise UpliftSettingConflictError(
            f"Add an uplift for {recommended['mechanic_label']} first"
        )
    return {
        "customer_id": customer_id,
        "sku_range": sku_range,
        "promotion_mechanic": recommended["mechanic_label"],
        "anchor_pct": recommended["anchor_pct"],
        "source": "recommended",
        "effective_from": common.this_month(),
        "updated_by": updated_by,
    }


def adopt_anchor(customer_id: int, sku_range: str | None = None, updated_by: str | None = None) -> dict:
    """Save what the data recommends now as a customer's (or range's) anchor; nothing is written when it already is."""

    with common.get_engine().begin() as conn:
        _check_anchor_target(conn, customer_id, sku_range)
        _lock(conn, "promo_anchor_settings")

        entry = _target_entry(conn, customer_id, sku_range)
        changed = entry["recommendation_differs"] or entry["source"] != "recommended"
        if changed:
            _insert_anchor(conn, _adopt_values(entry, customer_id, sku_range, updated_by or DEFAULT_CHANGED_BY))

        anchor = _anchors(conn, customer_id)[0]

    promo_recalc_events.enqueue_best_effort(changed and promo_recalc_events.enabled())
    return {"changed": changed, "anchor": anchor}


def seed_anchors(apply: bool = False, updated_by: str | None = None) -> list[dict]:
    """
    The first anchors: today's recommendation for every customer and
    customer x range that has one and nothing saved yet. Lists them without
    writing unless `apply`, then saves them all in one transaction.
    """

    with common.get_engine().begin() as conn:
        if apply:
            _lock(conn, "promo_anchor_settings")
        saved = _current_anchors(_anchor_rows(conn))

        planned = []
        for anchor in _anchors(conn):
            targets = [(None, anchor)] + [(item["sku_range"], item) for item in anchor["ranges"]]
            for sku_range, entry in targets:
                if (anchor["customer_id"], sku_range) in saved or entry["recommended"] is None:
                    continue
                if entry["recommended"]["anchor_pct"] is None:
                    continue
                values = _adopt_values(entry, anchor["customer_id"], sku_range, updated_by or DEFAULT_CHANGED_BY)
                planned.append({**values, "customer_name": anchor["customer_name"], "months": entry["recommended"]["months"]})

        if apply:
            for values in planned:
                _insert_anchor(conn, {key: value for key, value in values.items() if key not in ("customer_name", "months")})

    promo_recalc_events.enqueue_best_effort(apply and bool(planned) and promo_recalc_events.enabled())
    return planned


def anchor_history(customer_id: int | None, sku_range: str | None = None) -> list[dict]:
    """
    Every anchor version for a customer (or one of its ranges; customer_id
    None = the fallback), newest save first: the month each applies from,
    the one in effect this month (is_current) and those that start later
    (is_upcoming).
    """

    with common.read_connection() as conn:
        if customer_id is not None:
            _customers(conn, customer_id)
        rows = [
            row for row in _anchor_rows(conn)
            if row["customer_id"] == customer_id and row["sku_range"] == sku_range
        ]

    month = common.this_month()
    in_effect = _current_anchors(rows, month).get((customer_id, sku_range))
    rows.sort(key=lambda row: (row["updated_at"], row["id"]), reverse=True)
    return [
        {
            "id": row["id"],
            "anchor_pct": _num(row["anchor_pct"]),
            "mechanic_label": row["promotion_mechanic"],
            "source": row["source"],
            "effective_from": row["effective_from"].isoformat() if row["effective_from"] else None,
            "changed_by": row["updated_by"],
            "changed_at": common.iso(row["updated_at"]),
            "is_current": in_effect is not None and row["id"] == in_effect["id"],
            "is_upcoming": row["effective_from"] is not None and row["effective_from"] > month,
        }
        for row in rows
    ]


# ============================================================
# MECHANIC UPLIFTS: READS
#
# A row's target is its mechanic plus customer_id / sku_range / sku; its
# scope follows from which of those are set. The API keeps the names the
# frontend reads (id, mechanic_key, mechanic_label, scope, changed_*).
# ============================================================


def _scope(row: dict) -> str:
    if row["customer_id"] is None:
        return "all"
    if row["sku"] is not None:
        return "sku"
    if row["sku_range"] is not None:
        return "range"
    return "customer"


def _uplift_rows(conn: Connection) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                u.uplift_id AS id,
                u.customer_id,
                c.customer_name,
                u.sku_range,
                u.sku,
                u.promotion_mechanic,
                u.effective_discount_pct,
                u.uplift_pct,
                u.source,
                u.note,
                u.effective_from,
                u.updated_by,
                u.updated_at

            FROM promo_uplift_settings u
            LEFT JOIN customers c
                ON c.customer_id = u.customer_id
            """
        )
    ).mappings().all()

    return [
        {**dict(row), "mechanic_key": rules.mechanic_key(row["promotion_mechanic"]), "scope": _scope(row)}
        for row in rows
    ]


def _uplift_target(row: dict) -> tuple:
    return (row["mechanic_key"], row["customer_id"], row["sku_range"], row["sku"])


def _current_uplifts(uplift_rows: list[dict]) -> list[dict]:
    current = [row for row in common.newest(uplift_rows, _uplift_target).values() if row["source"] != "removed"]
    return sorted(
        current,
        key=lambda row: (
            row["effective_discount_pct"] is None,
            row["effective_discount_pct"] or 0,
            row["mechanic_key"] or "",
            row["id"],
        ),
    )


def _discount_by_key(current: list[dict]) -> dict[str, Decimal]:
    return {
        row["mechanic_key"]: Decimal(row["effective_discount_pct"])
        for row in current
        if row["scope"] == "all" and row["effective_discount_pct"] is not None
    }


def mechanic_discounts(conn: Connection) -> dict[str, dict]:
    """Each mechanic's standard label and effective discount, from its all-customers uplift row."""

    return {
        row["mechanic_key"]: {"label": row["promotion_mechanic"], "discount_pct": row["effective_discount_pct"]}
        for row in _current_uplifts(_uplift_rows(conn))
        if row["scope"] == "all" and row["mechanic_key"]
    }


def mechanic_discount_lookup(conn: Connection):
    """
    discount_in(mechanic_key, month): the mechanic's effective discount in
    effect that month (migration 021: a change applies from the month it was
    made, NULL = from the start), or None. For months in the past, so a
    discount changed today never moves them.
    """

    rows = [row for row in _uplift_rows(conn) if row["scope"] == "all" and row["mechanic_key"]]
    by_month: dict[date, dict[tuple, dict]] = {}

    def discount_in(mechanic_key: str, month: date) -> Decimal | None:
        if month not in by_month:
            by_month[month] = common.in_effect(rows, lambda row: (row["mechanic_key"],), month)
        row = by_month[month].get((mechanic_key,))
        if row is None or row["source"] == "removed" or row["effective_discount_pct"] is None:
            return None
        return Decimal(row["effective_discount_pct"])

    return discount_in


def _uplift_view(row: dict) -> dict:
    return {
        "id": row["id"],
        "mechanic_key": row["mechanic_key"],
        "mechanic_label": row["promotion_mechanic"],
        "effective_discount_pct": _num(row["effective_discount_pct"]),
        "scope": row["scope"],
        "customer_id": row["customer_id"],
        "customer_name": row["customer_name"],
        "sku_range": row["sku_range"],
        "sku": row["sku"],
        "uplift_pct": _num(row["uplift_pct"]),
        "source": row["source"],
        # Placeholder values with a discount are recalculated from each
        # customer's (and range's) anchor; every other value is used as stored.
        "follows_anchor": row["source"] == "placeholder" and row["effective_discount_pct"] is not None,
        "note": row["note"],
        "effective_from": row["effective_from"].isoformat() if row.get("effective_from") else None,
        "changed_by": row["updated_by"],
        "changed_at": common.iso(row["updated_at"]),
    }


def _unmapped_mechanics(conn: Connection, known_keys: set[str]) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                promotion_mechanic,
                COUNT(*) AS promotions

            FROM promotions

            WHERE
                promotion_mechanic IS NOT NULL

            GROUP BY
                promotion_mechanic
            """
        )
    ).mappings().all()

    unmapped = [
        {"promotion_mechanic": row["promotion_mechanic"], "promotions": row["promotions"]}
        for row in rows
        if rules.mechanic_key(row["promotion_mechanic"]) not in known_keys
    ]
    return sorted(unmapped, key=lambda row: row["promotion_mechanic"])


def list_settings() -> dict:
    """Every current uplift row, the all-customers anchor, and promotion mechanics that match none."""

    with common.read_connection() as conn:
        current = _current_uplifts(_uplift_rows(conn))
        default = _default_anchor(_current_anchors(_anchor_rows(conn)))
        unmapped = _unmapped_mechanics(conn, {row["mechanic_key"] for row in current})

    return {
        "settings": [_uplift_view(row) for row in current],
        "default_anchor_pct": _num(default),
        "unmapped_mechanics": unmapped,
    }


def _sku_for_product(conn: Connection, product_name: str) -> dict:
    row = conn.execute(
        text(
            """
            SELECT
                sku,
                sku_range

            FROM skus

            WHERE
                product_name = :product_name

            LIMIT 1
            """
        ),
        {"product_name": product_name},
    ).mappings().first()

    return dict(row) if row is not None else {"sku": None, "sku_range": None}


def _applies(row: dict, customer_id: int, sku: str | None, sku_range: str | None) -> bool:
    if row["scope"] == "all":
        return True
    if row["customer_id"] != customer_id:
        return False
    if row["scope"] == "customer":
        return True
    if row["scope"] == "range":
        return sku_range is not None and row["sku_range"] == sku_range
    # A SKU-level row (saved before uplifts followed SKU ranges) is kept in
    # the history but no longer applies: promotions are planned per range.
    return False


def _pick_uplifts(
    current: list[dict],
    customer_id: int,
    sku: str | None,
    sku_range: str | None,
    anchor_pct: Decimal,
) -> list[dict]:
    """Most specific current row per mechanic, with placeholders recalculated from the anchor."""

    chosen: dict[str, dict] = {}
    for row in current:
        if not _applies(row, customer_id, sku, sku_range):
            continue
        picked = chosen.get(row["mechanic_key"])
        if picked is None or _SCOPE_ORDER.index(row["scope"]) < _SCOPE_ORDER.index(picked["scope"]):
            chosen[row["mechanic_key"]] = row

    uplifts = []
    for row in chosen.values():
        view = _uplift_view(row)
        if view["follows_anchor"]:
            view["uplift_pct"] = _num(rules.placeholder_uplift(row["effective_discount_pct"], anchor_pct))
        uplifts.append(view)

    uplifts.sort(key=lambda view: (view["effective_discount_pct"] is None, view["effective_discount_pct"] or 0))
    return uplifts


def resolve_uplifts(customer_name: str, product_name: str | None = None, sku_range: str | None = None) -> dict:
    """
    The uplift of every mechanic for one customer and SKU range (the
    Scenario builder plans promotions per range; product_name, one SKU, only
    for promotions saved before that; both None = all SKUs): the most
    specific current row (range, customer, all), with placeholder values
    recalculated from the range's anchor (the customer's for all SKUs).

    For all SKUs, `product_uplifts` also lists the products whose own value
    differs from the customer's, as {product_name: {mechanic_key:
    uplift_pct}}, so an all-SKUs promotion can apply each product's value.
    A product differs through its own SKU or range value, or its range
    anchor; `product_anchors` lists the products whose range anchor differs
    from the customer's, as {product_name: anchor_pct}.
    """

    with common.read_connection() as conn:
        customer = _customer_by_name(conn, customer_name)
        anchor = _anchors(conn, customer["customer_id"], with_recommendations=False)[0]
        if sku_range:
            product = {"sku": None, "sku_range": sku_range}
        elif product_name:
            product = _sku_for_product(conn, product_name)
        else:
            product = {"sku": None, "sku_range": None}
        current = _current_uplifts(_uplift_rows(conn))
        all_skus = product_name is None and sku_range is None
        products = _products(conn) if all_skus else []
        ranges = _ranges(conn) if all_skus else []

    customer_id = customer["customer_id"]
    uplifts = _pick_uplifts(
        current, customer_id, product["sku"], product["sku_range"], _anchor_pct_for(anchor, product["sku_range"])
    )

    customer_values = {view["mechanic_key"]: view["uplift_pct"] for view in uplifts}
    customer_anchor = Decimal(str(anchor["anchor_pct"]))
    product_uplifts: dict[str, dict[str, float]] = {}
    product_anchors: dict[str, float] = {}
    for item in products:
        item_anchor = _anchor_pct_for(anchor, item["sku_range"])
        if item_anchor != customer_anchor:
            product_anchors[item["product_name"]] = _num(item_anchor)
        own = _pick_uplifts(current, customer_id, item["sku"], item["sku_range"], item_anchor)
        differing = {
            view["mechanic_key"]: view["uplift_pct"]
            for view in own
            if view["uplift_pct"] != customer_values.get(view["mechanic_key"])
        }
        if differing:
            product_uplifts[item["product_name"]] = differing

    # The same per SKU range, which is how the Scenario builder plans
    # promotions: a range promotion takes its range's values and anchor.
    range_uplifts: dict[str, dict[str, float]] = {}
    range_anchors: dict[str, float] = {}
    for range_name in ranges:
        range_anchor = _anchor_pct_for(anchor, range_name)
        if range_anchor != customer_anchor:
            range_anchors[range_name] = _num(range_anchor)
        own = _pick_uplifts(current, customer_id, None, range_name, range_anchor)
        differing = {
            view["mechanic_key"]: view["uplift_pct"]
            for view in own
            if view["uplift_pct"] != customer_values.get(view["mechanic_key"])
        }
        if differing:
            range_uplifts[range_name] = differing

    return {
        "customer_name": customer["customer_name"],
        "product_name": product_name,
        "sku_range": product["sku_range"],
        "anchor": anchor,
        "uplifts": uplifts,
        "product_uplifts": product_uplifts,
        "product_anchors": product_anchors,
        "range_uplifts": range_uplifts,
        "range_anchors": range_anchors,
        # Which range each product is in, so a promotion on some ranges keeps
        # only those products' own values.
        "product_ranges": {item["product_name"]: item["sku_range"] for item in products if item["sku_range"]},
    }


def match_mechanic(label: str) -> dict:
    """Which mechanic a promotion label would count as, and its current all-customers value."""

    key = rules.mechanic_key(label)
    with common.read_connection() as conn:
        current = _current_uplifts(_uplift_rows(conn))

    row = next((row for row in current if row["scope"] == "all" and row["mechanic_key"] == key), None)
    return {
        "label": label,
        "mechanic_key": key,
        "matched": row is not None,
        "setting": _uplift_view(row) if row is not None else None,
    }


def mechanic_history(mechanic_key: str) -> list[dict]:
    """
    Every version of a mechanic's rows at every target, newest first;
    `superseded_at` is when the next version of the same target replaced it.
    """

    with common.read_connection() as conn:
        rows = [row for row in _uplift_rows(conn) if row["mechanic_key"] == mechanic_key]

    if not rows:
        raise MechanicNotFoundError(f"Mechanic {mechanic_key} does not exist.")

    rows.sort(key=lambda row: (row["updated_at"], row["id"]), reverse=True)
    replaced_at: dict[tuple, str | None] = {}
    history = []
    for row in rows:
        target = _uplift_target(row)
        history.append({**_uplift_view(row), "superseded_at": replaced_at.get(target)})
        replaced_at[target] = common.iso(row["updated_at"])
    return history


# ============================================================
# MECHANIC DISCOUNTS: WRITES
#
# Uplifts are never typed: they are worked out from moments and the anchor
# (promo_recalc, promo_uplift_calc). What a person edits is a mechanic's
# effective discount, which the placeholder rule and anchors use; an edit
# inserts a new version of the mechanic's all-customers row. Earlier typed
# values ('estimate' rows, overrides) stay in the history, unused.
# ============================================================


def _insert_uplift(conn: Connection, values: dict) -> int:
    row = conn.execute(
        text(
            """
            INSERT INTO promo_uplift_settings (
                customer_id,
                sku_range,
                sku,
                promotion_mechanic,
                effective_discount_pct,
                uplift_pct,
                source,
                note,
                effective_from,
                updated_by
            )
            VALUES (
                CAST(:customer_id AS integer),
                :sku_range,
                :sku,
                :promotion_mechanic,
                CAST(:effective_discount_pct AS numeric(5, 2)),
                CAST(:uplift_pct AS numeric(6, 2)),
                :source,
                :note,
                CAST(:effective_from AS date),
                :updated_by
            )
            RETURNING uplift_id
            """
        ),
        values,
    ).first()

    promo_recalc_events.record_customers(conn, "mechanic_change", None, "promo_uplift_settings")
    return row[0]


def _fetch_uplift(conn: Connection, setting_id: int) -> dict:
    row = next(row for row in _uplift_rows(conn) if row["id"] == setting_id)
    return _uplift_view(row)


def _copy(row: dict, **changes) -> dict:
    values = {
        key: row[key]
        for key in ("customer_id", "sku_range", "sku", "promotion_mechanic", "effective_discount_pct", "uplift_pct", "note")
    }
    return {**values, **changes}


def set_mechanic_discount(
    mechanic_key: str,
    discount_pct: Decimal,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict:
    """
    Change a mechanic's effective discount, as a new version of its
    all-customers row, from this month on (earlier months keep theirs). Every customer is recalculated, since
    the placeholder rule and the anchors that use the mechanic move with it.
    `changed` is False when it already has that discount.
    """

    with common.get_engine().begin() as conn:
        _lock(conn, "promo_uplift_settings")
        rows = _uplift_rows(conn)
        base = next(
            (row for row in _current_uplifts(rows) if row["scope"] == "all" and row["mechanic_key"] == mechanic_key),
            None,
        )
        if base is None:
            raise MechanicNotFoundError(f"Mechanic {mechanic_key} does not exist.")

        current = base["effective_discount_pct"]
        if current is not None and Decimal(current) == Decimal(discount_pct):
            return {"changed": False, "setting": _uplift_view(base)}

        uplift_pct = base["uplift_pct"]
        if base["source"] == "placeholder":
            uplift_pct = rules.placeholder_uplift(discount_pct, rules.FALLBACK_ANCHOR_PCT)
        new_id = _insert_uplift(
            conn,
            _copy(
                base,
                effective_discount_pct=discount_pct,
                uplift_pct=uplift_pct,
                note=note,
                source=base["source"],
                effective_from=common.this_month(),
                updated_by=updated_by or DEFAULT_CHANGED_BY,
            ),
        )
        setting = _uplift_view(next(row for row in _uplift_rows(conn) if row["id"] == new_id))

    promo_recalc_events.enqueue_best_effort(promo_recalc_events.enabled())
    return {"changed": True, "setting": setting}
