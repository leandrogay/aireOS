from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.sellout_service import EFFECTIVE_SELLOUT_CTE
from app.services.settings import common
from app.services.settings import promo_uplift_rules as rules
from app.services.settings.common import CustomerNotFoundError


# Promotion Uplift Settings: the uplift per promotion mechanic
# (promo_uplift_settings) and each customer's ordinary-month discount, the
# "anchor" that rule-based uplifts are worked out from (promo_anchor_settings),
# and the rule's rate itself (promo_rule_settings).
# Both tables are append-only: a change supersedes the current row
# (superseded_at is the only column ever updated) and inserts a new one.
# The rules themselves are pure and live in promo_uplift_rules.py.


# ============================================================
# Custom Exceptions
# ============================================================


class UpliftSettingNotFoundError(Exception):
    pass


class MechanicNotFoundError(Exception):
    pass


class UpliftSettingConflictError(Exception):
    pass


# ============================================================
# Constants
# ============================================================

# Edits are recorded as the app until it has user accounts (same as the DOH
# settings page, frontend settingsApi.UPDATED_BY).
DEFAULT_CHANGED_BY = "aireos"

# Most specific first: the scope a mechanic's value is taken from.
_SCOPE_ORDER = ("sku", "range", "customer", "all")

_UPLIFT_COLUMNS = """
    s.id,
    s.mechanic_key,
    s.mechanic_label,
    s.effective_discount_pct,
    s.scope,
    s.customer_id,
    c.customer_name,
    s.sku_range,
    s.sku,
    s.uplift_pct,
    s.source,
    s.kind,
    s.evidence_months,
    s.note,
    s.changed_by,
    s.changed_at,
    s.superseded_at,
    s.archived_at
"""

_UPLIFT_FROM = """
    FROM promo_uplift_settings s
    LEFT JOIN customers c
        ON c.customer_id = s.customer_id
"""


def _num(value) -> float | None:
    return float(value) if value is not None else None


def _uplift_view(row: dict) -> dict:
    return {
        "id": row["id"],
        "mechanic_key": row["mechanic_key"],
        "mechanic_label": row["mechanic_label"],
        "effective_discount_pct": _num(row["effective_discount_pct"]),
        "scope": row["scope"],
        "customer_id": row["customer_id"],
        "customer_name": row["customer_name"],
        "sku_range": row["sku_range"],
        "sku": row["sku"],
        "uplift_pct": _num(row["uplift_pct"]),
        "source": row["source"],
        "kind": row.get("kind") or ("voucher" if row["mechanic_key"] == rules.VOUCHER_KEY else "promotion"),
        # Rule-based uplifts with a discount are worked out again from the
        # rule and each customer's anchor; every other uplift is used as stored.
        "follows_rule": row["source"] == "rule_based" and row["effective_discount_pct"] is not None,
        # Set where the rule's answer had to be kept within -90..+300.
        "capped": False,
        "evidence_months": _num(row.get("evidence_months")),
        "note": row["note"],
        "changed_by": row["changed_by"],
        "changed_at": common.iso(row["changed_at"]),
        "superseded_at": common.iso(row["superseded_at"]),
        "archived_at": common.iso(row.get("archived_at")),
    }


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


# ============================================================
# READS SHARED BY SEVERAL ENDPOINTS
# ============================================================


def _current_uplift_rows(conn: Connection) -> list[dict]:
    rows = conn.execute(
        text(
            f"""
            SELECT {_UPLIFT_COLUMNS}
            {_UPLIFT_FROM}

            WHERE
                s.superseded_at IS NULL

            ORDER BY
                s.effective_discount_pct ASC NULLS LAST,
                s.mechanic_key ASC,
                s.id ASC
            """
        )
    ).mappings().all()

    return [dict(row) for row in rows]


def _discount_by_key(uplift_rows: list[dict]) -> dict[str, Decimal]:
    return {
        row["mechanic_key"]: Decimal(row["effective_discount_pct"])
        for row in uplift_rows
        if row["scope"] == "all" and row["effective_discount_pct"] is not None
    }


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


def store_key(retailer_id, store_code) -> str | None:
    """One store, as promotions and sales both name it (retailer + store code)."""

    if retailer_id is None or store_code is None:
        return None
    return f"{retailer_id}|{store_code}"


def _promotions_by_customer(conn: Connection, customer_id: int | None = None) -> dict[int, list[dict]]:
    """
    Every promotion on any of a customer's channels (customer_retailers maps
    fairprice to fairprice_offline and fairprice_online), once per customer,
    with the stores it ran in (`stores`), so the anchor can weight a
    promotion by how much of the customer's sales those stores make.
    """

    rows = conn.execute(
        text(
            """
            SELECT DISTINCT
                cr.customer_id,
                p.promotion_id,
                p.period_start,
                p.period_end,
                p.promo_type,
                p.promotion_mechanic,
                s.retailer_id,
                s.store_code

            FROM promotions p
            JOIN promotion_stores ps
                ON ps.promotion_id = p.promotion_id
            JOIN stores s
                ON s.store_id = ps.store_id
            JOIN customer_retailers cr
                ON cr.retailer_id = s.retailer_id

            WHERE
                CAST(:customer_id AS integer) IS NULL
                OR cr.customer_id = CAST(:customer_id AS integer)
            """
        ),
        {"customer_id": customer_id},
    ).mappings().all()

    promotions: dict[tuple, dict] = {}
    for row in rows:
        key = (row["customer_id"], row["promotion_id"])
        promotion = promotions.setdefault(key, {**dict(row), "stores": set()})
        store = store_key(row.get("retailer_id"), row.get("store_code"))
        if store is not None:
            promotion["stores"].add(store)

    by_customer: dict[int, list[dict]] = {}
    for (customer, _promotion_id), promotion in promotions.items():
        by_customer.setdefault(customer, []).append(promotion)
    return by_customer


def _store_weights_by_customer(conn: Connection, customer_id: int | None = None) -> dict[int, dict]:
    """
    Each store's share of a customer's units sold (every SKU, every month of
    sell-out, monthly rows preferred over weekly ones as on the dashboard).
    A customer with no sales gets no weights, so every store counts the same.
    """

    rows = conn.execute(
        text(
            EFFECTIVE_SELLOUT_CTE
            + """
            SELECT
                cr.customer_id,
                es.retailer_id,
                es.store_code,
                SUM(es.quantity_units) AS units

            FROM effective_sellout es
            JOIN customer_retailers cr
                ON cr.retailer_id = es.retailer_id

            WHERE
                CAST(:customer_id AS integer) IS NULL
                OR cr.customer_id = CAST(:customer_id AS integer)

            GROUP BY
                cr.customer_id,
                es.retailer_id,
                es.store_code
            """
        ),
        {"customer_id": customer_id},
    ).mappings().all()

    units: dict[int, dict] = {}
    for row in rows:
        units.setdefault(row["customer_id"], {})[store_key(row["retailer_id"], row["store_code"])] = float(row["units"] or 0)

    weights = {}
    for customer, by_store in units.items():
        total = sum(value for value in by_store.values() if value > 0)
        if total > 0:
            weights[customer] = {store: max(value, 0) / total for store, value in by_store.items()}
    return weights


# ============================================================
# ANCHOR (ordinary-month discount)
#
# Order: the customer's manual value, else the suggestion from its own
# promotions, else the all-customers value, else 20%. A 'suggested' row
# (anchor_pct NULL) is a reset: it says "use the data" again.
# ============================================================


def _current_anchor_rows(conn: Connection) -> dict[int | None, dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                id,
                customer_id,
                anchor_pct,
                source,
                changed_by,
                changed_at

            FROM promo_anchor_settings

            WHERE
                superseded_at IS NULL
            """
        )
    ).mappings().all()

    return {row["customer_id"]: dict(row) for row in rows}


def _default_anchor(anchor_rows: dict[int | None, dict]) -> Decimal:
    row = anchor_rows.get(None)
    if row is not None and row["anchor_pct"] is not None:
        return Decimal(row["anchor_pct"])
    return rules.FALLBACK_ANCHOR_PCT


def _anchor_view(
    customer: dict,
    anchor_rows: dict[int | None, dict],
    promotions: list[dict],
    discount_by_key: dict[str, Decimal],
    store_weights: dict | None = None,
) -> dict:
    # Only months before this one: planned promotions describe what may run,
    # not what an ordinary month has been.
    before = _utc_today().replace(day=1)
    suggestion = rules.suggest_anchor(
        rules.monthly_discounts(promotions, discount_by_key, store_weights=store_weights, before=before)
    )
    row = anchor_rows.get(customer["customer_id"])

    if row is not None and row["source"] == "manual":
        anchor_pct, source = Decimal(row["anchor_pct"]), "manual"
    elif suggestion is not None:
        anchor_pct, source = suggestion["anchor_pct"], "suggested"
    else:
        anchor_pct, source = _default_anchor(anchor_rows), "default"

    return {
        "customer_id": customer["customer_id"],
        "customer_name": customer["customer_name"],
        "anchor_pct": _num(anchor_pct),
        "source": source,
        "suggested": (
            {**suggestion, "anchor_pct": _num(suggestion["anchor_pct"])}
            if suggestion is not None
            else None
        ),
        "default_anchor_pct": _num(_default_anchor(anchor_rows)),
        "changed_by": row["changed_by"] if row else None,
        "changed_at": common.iso(row["changed_at"]) if row else None,
    }


def _anchors(conn: Connection, customer_id: int | None = None) -> list[dict]:
    customers = _customers(conn, customer_id)
    anchor_rows = _current_anchor_rows(conn)
    discount_by_key = _discount_by_key(_current_uplift_rows(conn))
    promotions = _promotions_by_customer(conn, customer_id)
    weights = _store_weights_by_customer(conn, customer_id)

    return [
        _anchor_view(
            customer,
            anchor_rows,
            promotions.get(customer["customer_id"], []),
            discount_by_key,
            weights.get(customer["customer_id"]),
        )
        for customer in customers
    ]


def list_anchors() -> dict:
    """Every customer's anchor (current, suggested and why), plus the all-customers value."""

    with common.read_connection() as conn:
        customers = _anchors(conn)
        default = _default_anchor(_current_anchor_rows(conn))

    return {"default_anchor_pct": _num(default), "customers": customers}


def get_anchor(customer_id: int) -> dict:
    with common.read_connection() as conn:
        return _anchors(conn, customer_id)[0]


def _supersede_anchor(conn: Connection, customer_id: int | None) -> None:
    conn.execute(
        text(
            """
            UPDATE promo_anchor_settings

            SET
                superseded_at = now()

            WHERE
                customer_id IS NOT DISTINCT FROM CAST(:customer_id AS integer)
                AND superseded_at IS NULL
            """
        ),
        {"customer_id": customer_id},
    )


def _insert_anchor(
    conn: Connection,
    customer_id: int | None,
    anchor_pct: Decimal | None,
    source: str,
    changed_by: str,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO promo_anchor_settings (
                customer_id,
                anchor_pct,
                source,
                changed_by
            )
            VALUES (
                CAST(:customer_id AS integer),
                CAST(:anchor_pct AS numeric(5, 2)),
                :source,
                :changed_by
            )
            """
        ),
        {"customer_id": customer_id, "anchor_pct": anchor_pct, "source": source, "changed_by": changed_by},
    )


def set_anchor(customer_id: int | None, anchor_pct: Decimal, updated_by: str | None = None) -> dict:
    """
    Type in a customer's anchor (customer_id None = the all-customers value),
    as a new version. `changed` is False when it already has that manual value.
    """

    with common.get_engine().begin() as conn:
        if customer_id is not None:
            common.lock_customer(conn, customer_id)

        current = _current_anchor_rows(conn).get(customer_id)
        changed = not (
            current is not None
            and current["source"] == "manual"
            and Decimal(current["anchor_pct"]) == Decimal(anchor_pct)
        )
        if changed:
            _supersede_anchor(conn, customer_id)
            _insert_anchor(conn, customer_id, anchor_pct, "manual", updated_by or DEFAULT_CHANGED_BY)

        if customer_id is None:
            default = _default_anchor(_current_anchor_rows(conn))
            return {"changed": changed, "default_anchor_pct": _num(default)}
        anchor = _anchors(conn, customer_id)[0]

    return {"changed": changed, "anchor": anchor}


def reset_anchor(customer_id: int, updated_by: str | None = None) -> dict:
    """Put a customer back on the suggestion from its data; nothing is written when it already is."""

    with common.get_engine().begin() as conn:
        common.lock_customer(conn, customer_id)

        current = _current_anchor_rows(conn).get(customer_id)
        changed = current is not None and current["source"] == "manual"
        if changed:
            _supersede_anchor(conn, customer_id)
            _insert_anchor(conn, customer_id, None, "suggested", updated_by or DEFAULT_CHANGED_BY)

        anchor = _anchors(conn, customer_id)[0]

    return {"changed": changed, "anchor": anchor}


def anchor_history(customer_id: int) -> list[dict]:
    """Every anchor version for a customer, newest first."""

    with common.read_connection() as conn:
        _customers(conn, customer_id)
        rows = conn.execute(
            text(
                """
                SELECT
                    id,
                    anchor_pct,
                    source,
                    changed_by,
                    changed_at,
                    superseded_at

                FROM promo_anchor_settings

                WHERE
                    customer_id = :customer_id

                ORDER BY
                    changed_at DESC,
                    id DESC
                """
            ),
            {"customer_id": customer_id},
        ).mappings().all()

    return [
        {
            "id": row["id"],
            "anchor_pct": _num(row["anchor_pct"]),
            "source": row["source"],
            "changed_by": row["changed_by"],
            "changed_at": common.iso(row["changed_at"]),
            "is_current": row["superseded_at"] is None,
        }
        for row in rows
    ]


# ============================================================
# MECHANIC UPLIFTS: READS
# ============================================================


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
    """Every current uplift row, the all-customers anchor, the rule, and promotion mechanics that match none."""

    with common.read_connection() as conn:
        uplift_rows = _current_uplift_rows(conn)
        default = _default_anchor(_current_anchor_rows(conn))
        unmapped = _unmapped_mechanics(conn, {row["mechanic_key"] for row in uplift_rows})
        rule = _rule_view(_current_rule_row(conn))

    return {
        "settings": [_uplift_view(row) for row in uplift_rows],
        "default_anchor_pct": _num(default),
        "unmapped_mechanics": unmapped,
        "rule": rule,
    }


def _sku_for_product(conn: Connection, product_name: str) -> dict:
    # product_name isn't unique in skus: an active SKU wins over an archived
    # one with the same name (the same rule as the building blocks' lookup).
    row = conn.execute(
        text(
            """
            SELECT
                sku,
                sku_range

            FROM skus

            WHERE
                product_name = :product_name

            ORDER BY
                is_active DESC,
                sku ASC

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
    return sku is not None and row["sku"] == sku


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

            ORDER BY
                is_active ASC,
                sku DESC
            """
        )
    ).mappings().all()

    # One SKU per product name: rows come archived-first, so an active SKU
    # with the same name overwrites it.
    by_name = {row["product_name"]: dict(row) for row in rows}
    return list(by_name.values())


def _pick_uplifts(
    uplift_rows: list[dict],
    customer_id: int,
    sku: str | None,
    sku_range: str | None,
    anchor_pct: Decimal,
    uplift_per_point_pct: Decimal = rules.DEFAULT_UPLIFT_PER_POINT_PCT,
) -> list[dict]:
    """Most specific current row per mechanic, with rule-based uplifts worked out from the rule and anchor."""

    chosen: dict[str, dict] = {}
    for row in uplift_rows:
        if row.get("archived_at") is not None or not _applies(row, customer_id, sku, sku_range):
            continue
        current = chosen.get(row["mechanic_key"])
        if current is None or _SCOPE_ORDER.index(row["scope"]) < _SCOPE_ORDER.index(current["scope"]):
            chosen[row["mechanic_key"]] = row

    uplifts = []
    for row in chosen.values():
        view = _uplift_view(row)
        if view["follows_rule"]:
            discount = row["effective_discount_pct"]
            view["uplift_pct"] = _num(rules.rule_based_uplift(discount, anchor_pct, uplift_per_point_pct))
            view["capped"] = rules.rule_based_uplift_capped(discount, anchor_pct, uplift_per_point_pct)
        uplifts.append(view)

    uplifts.sort(key=lambda view: (view["effective_discount_pct"] is None, view["effective_discount_pct"] or 0))
    return uplifts


def resolve_uplifts(customer_name: str, product_name: str | None = None) -> dict:
    """
    The uplift of every mechanic for one customer and product (None = all
    SKUs), as the Scenario builder uses it: the most specific current row
    (SKU, range, customer, all), with rule-based uplifts worked out from the
    rule and
    the customer's anchor.

    For all SKUs, `product_uplifts` also lists the products whose own (SKU or
    range) value differs from the customer's, as {product_name: {mechanic_key:
    uplift_pct}}, so an all-SKUs promotion can apply each product's value, and
    `product_sources` where each came from ({product_name: {mechanic_key:
    {source, evidence_months}}}). Archived mechanics are left out.
    """

    with common.read_connection() as conn:
        customer = _customer_by_name(conn, customer_name)
        anchor = _anchors(conn, customer["customer_id"])[0]
        product = _sku_for_product(conn, product_name) if product_name else {"sku": None, "sku_range": None}
        uplift_rows = _current_uplift_rows(conn)
        rate = _current_rate(conn)

        has_product_rows = any(
            row["scope"] in ("range", "sku") and row["customer_id"] == customer["customer_id"]
            for row in uplift_rows
        )
        products = _products(conn) if product_name is None and has_product_rows else []

    anchor_pct = Decimal(str(anchor["anchor_pct"]))
    uplifts = _pick_uplifts(uplift_rows, customer["customer_id"], product["sku"], product["sku_range"], anchor_pct, rate)

    customer_values = {view["mechanic_key"]: (view["uplift_pct"], view["source"]) for view in uplifts}
    product_uplifts: dict[str, dict[str, float]] = {}
    product_sources: dict[str, dict[str, dict]] = {}
    for item in products:
        own = _pick_uplifts(uplift_rows, customer["customer_id"], item["sku"], item["sku_range"], anchor_pct, rate)
        differing = [
            view
            for view in own
            if (view["uplift_pct"], view["source"]) != customer_values.get(view["mechanic_key"])
        ]
        if differing:
            product_uplifts[item["product_name"]] = {view["mechanic_key"]: view["uplift_pct"] for view in differing}
            product_sources[item["product_name"]] = {
                view["mechanic_key"]: {"source": view["source"], "evidence_months": view["evidence_months"]}
                for view in differing
            }

    return {
        "customer_name": customer["customer_name"],
        "product_name": product_name,
        "anchor": anchor,
        "uplifts": uplifts,
        "product_uplifts": product_uplifts,
        "product_sources": product_sources,
    }


def match_mechanic(label: str) -> dict:
    """Which mechanic a promotion label would count as, and its current all-customers value."""

    key = rules.mechanic_key(label)
    with common.read_connection() as conn:
        rows = [row for row in _current_uplift_rows(conn) if row["scope"] == "all"]

    row = next((row for row in rows if row["mechanic_key"] == key), None)
    return {
        "label": label,
        "mechanic_key": key,
        "matched": row is not None,
        "setting": _uplift_view(row) if row is not None else None,
    }


def mechanic_history(mechanic_key: str) -> list[dict]:
    """Every version of a mechanic's rows at every scope, newest first."""

    with common.read_connection() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT {_UPLIFT_COLUMNS}
                {_UPLIFT_FROM}

                WHERE
                    s.mechanic_key = :mechanic_key

                ORDER BY
                    s.changed_at DESC,
                    s.id DESC
                """
            ),
            {"mechanic_key": mechanic_key},
        ).mappings().all()

    if not rows:
        raise MechanicNotFoundError(f"Mechanic {mechanic_key} does not exist.")
    return [_uplift_view(dict(row)) for row in rows]


# ============================================================
# MECHANIC UPLIFTS: WRITES
#
# An edit supersedes the current row and inserts a copy with the new value,
# in one transaction. A typed value becomes source 'estimate', so it no
# longer follows the rule; reset puts it back on the rule.
# Learned values belong to the forecasting model and cannot be edited here.
# ============================================================


def _lock_current_row(conn: Connection, setting_id: int, allow_archived: bool = False) -> dict:
    row = conn.execute(
        text(
            f"""
            SELECT {_UPLIFT_COLUMNS}
            {_UPLIFT_FROM}

            WHERE
                s.id = :setting_id

            FOR UPDATE OF s
            """
        ),
        {"setting_id": setting_id},
    ).mappings().first()

    if row is None:
        raise UpliftSettingNotFoundError(f"Uplift setting {setting_id} does not exist.")
    if row["superseded_at"] is not None:
        raise UpliftSettingConflictError(
            f"Uplift setting {setting_id} has been replaced by a newer version; reload and try again."
        )
    if row["source"] == "learned":
        raise UpliftSettingConflictError(
            "Learned values are set by the forecasting model after each retrain and cannot be edited."
        )
    if row.get("archived_at") is not None and not allow_archived:
        raise UpliftSettingConflictError("This value is archived; restore it before changing it.")
    return dict(row)


def _supersede_uplift(conn: Connection, setting_id: int) -> None:
    conn.execute(
        text(
            """
            UPDATE promo_uplift_settings

            SET
                superseded_at = now()

            WHERE
                id = :setting_id
                AND superseded_at IS NULL
            """
        ),
        {"setting_id": setting_id},
    )


def _insert_uplift(conn: Connection, values: dict) -> int:
    row = conn.execute(
        text(
            """
            INSERT INTO promo_uplift_settings (
                mechanic_key,
                mechanic_label,
                effective_discount_pct,
                scope,
                customer_id,
                sku_range,
                sku,
                uplift_pct,
                source,
                kind,
                evidence_months,
                note,
                changed_by,
                archived_at
            )
            VALUES (
                :mechanic_key,
                :mechanic_label,
                CAST(:effective_discount_pct AS numeric(5, 2)),
                :scope,
                CAST(:customer_id AS integer),
                :sku_range,
                :sku,
                CAST(:uplift_pct AS numeric(6, 2)),
                :source,
                :kind,
                CAST(:evidence_months AS numeric(6, 2)),
                :note,
                :changed_by,
                CAST(:archived_at AS timestamptz)
            )
            RETURNING id
            """
        ),
        values,
    ).first()

    return row[0]


def _fetch_uplift(conn: Connection, setting_id: int) -> dict:
    row = conn.execute(
        text(
            f"""
            SELECT {_UPLIFT_COLUMNS}
            {_UPLIFT_FROM}

            WHERE
                s.id = :setting_id
            """
        ),
        {"setting_id": setting_id},
    ).mappings().first()

    return _uplift_view(dict(row))


def _copy(row: dict, **changes) -> dict:
    values = {
        key: row[key]
        for key in (
            "mechanic_key",
            "mechanic_label",
            "effective_discount_pct",
            "scope",
            "customer_id",
            "sku_range",
            "sku",
            "uplift_pct",
            "note",
        )
    }
    values["kind"] = row.get("kind") or ("voucher" if row["mechanic_key"] == rules.VOUCHER_KEY else "promotion")
    values["evidence_months"] = None
    values["archived_at"] = None
    return {**values, **changes}


def update_uplift(
    setting_id: int,
    uplift_pct: Decimal,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict:
    """
    Type a mechanic's uplift as a new version (source 'estimate'). `changed`
    is False when it is already that estimate.
    """

    with common.get_engine().begin() as conn:
        row = _lock_current_row(conn, setting_id)

        if row["source"] == "estimate" and Decimal(row["uplift_pct"]) == Decimal(uplift_pct) and row["note"] == note:
            return {"changed": False, "setting": _uplift_view(row)}

        _supersede_uplift(conn, setting_id)
        new_id = _insert_uplift(
            conn,
            _copy(row, uplift_pct=uplift_pct, note=note, source="estimate", changed_by=updated_by or DEFAULT_CHANGED_BY),
        )
        setting = _fetch_uplift(conn, new_id)

    return {"changed": True, "setting": setting}


def _last_rule_based_uplift(conn: Connection, mechanic_key: str) -> Decimal | None:
    # The voucher has no discount to calculate from, so its rule-based uplift
    # is the latest one it was given (+3 from the seed).
    row = conn.execute(
        text(
            """
            SELECT
                uplift_pct

            FROM promo_uplift_settings

            WHERE
                mechanic_key = :mechanic_key
                AND scope = 'all'
                AND source = 'rule_based'

            ORDER BY
                changed_at DESC,
                id DESC

            LIMIT 1
            """
        ),
        {"mechanic_key": mechanic_key},
    ).first()

    return row[0] if row is not None else None


def reset_uplift(setting_id: int, updated_by: str | None = None) -> dict:
    """
    Undo a typed uplift. An all-customers row goes back on the rule-based
    rule; a customer, range or SKU row is retired, so the broader value
    applies again. `changed` is False when it is already rule-based.
    """

    with common.get_engine().begin() as conn:
        row = _lock_current_row(conn, setting_id)

        if row["source"] == "rule_based":
            return {"changed": False, "setting": _uplift_view(row)}

        _supersede_uplift(conn, setting_id)
        if row["scope"] != "all":
            return {"changed": True, "setting": None}

        if row["effective_discount_pct"] is not None:
            # Stored as a reference only (worked out again whenever used).
            uplift_pct = rules.rule_based_uplift(
                row["effective_discount_pct"], rules.FALLBACK_ANCHOR_PCT, _current_rate(conn)
            )
        else:
            uplift_pct = _last_rule_based_uplift(conn, row["mechanic_key"])
            if uplift_pct is None:
                raise UpliftSettingConflictError(f"{row['mechanic_label']} has no rule-based uplift to go back to.")

        new_id = _insert_uplift(
            conn,
            _copy(row, uplift_pct=uplift_pct, note=None, source="rule_based", changed_by=updated_by or DEFAULT_CHANGED_BY),
        )
        setting = _fetch_uplift(conn, new_id)

    return {"changed": True, "setting": setting}


def add_override(
    mechanic_key: str,
    scope: str,
    customer_id: int,
    uplift_pct: Decimal,
    sku_range: str | None = None,
    sku: str | None = None,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict:
    """A mechanic's own value for one customer, SKU range or SKU (source 'estimate')."""

    with common.get_engine().begin() as conn:
        common.lock_customer(conn, customer_id)

        rows = _current_uplift_rows(conn)
        base = next(
            (
                row for row in rows
                if row["mechanic_key"] == mechanic_key and row["scope"] == "all" and row.get("archived_at") is None
            ),
            None,
        )
        if base is None:
            raise MechanicNotFoundError(f"Mechanic {mechanic_key} does not exist.")

        duplicate = any(
            row["mechanic_key"] == mechanic_key
            and row["scope"] == scope
            and row["customer_id"] == customer_id
            and row["sku_range"] == sku_range
            and row["sku"] == sku
            for row in rows
        )
        if duplicate:
            raise UpliftSettingConflictError(
                f"{base['mechanic_label']} already has a value at this scope; edit that one instead."
            )

        new_id = _insert_uplift(
            conn,
            _copy(
                base,
                scope=scope,
                customer_id=customer_id,
                sku_range=sku_range,
                sku=sku,
                uplift_pct=uplift_pct,
                note=note,
                source="estimate",
                changed_by=updated_by or DEFAULT_CHANGED_BY,
            ),
        )
        setting = _fetch_uplift(conn, new_id)

    return {"changed": True, "setting": setting}


# ============================================================
# ARCHIVE, RESTORE AND NEW MECHANICS
#
# Archiving is a new version with archived_at set: the mechanic stays in the
# table and its history, but is no longer offered in the Scenario builder or
# measured. Restoring is a new version with archived_at empty again.
# ============================================================


def archive_uplift(setting_id: int, updated_by: str | None = None) -> dict:
    """Archive a value as a new version. `changed` is False when it already is."""

    with common.get_engine().begin() as conn:
        row = _lock_current_row(conn, setting_id, allow_archived=True)
        if row.get("archived_at") is not None:
            return {"changed": False, "setting": _uplift_view(row)}

        _supersede_uplift(conn, setting_id)
        new_id = _insert_uplift(
            conn,
            _copy(
                row,
                source=row["source"],
                evidence_months=row.get("evidence_months"),
                archived_at=datetime.now(timezone.utc),
                changed_by=updated_by or DEFAULT_CHANGED_BY,
            ),
        )
        setting = _fetch_uplift(conn, new_id)

    return {"changed": True, "setting": setting}


def restore_uplift(setting_id: int, updated_by: str | None = None) -> dict:
    """Bring an archived value back as a new version. `changed` is False when it isn't archived."""

    with common.get_engine().begin() as conn:
        row = _lock_current_row(conn, setting_id, allow_archived=True)
        if row.get("archived_at") is None:
            return {"changed": False, "setting": _uplift_view(row)}

        _supersede_uplift(conn, setting_id)
        new_id = _insert_uplift(
            conn,
            _copy(
                row,
                source=row["source"],
                evidence_months=row.get("evidence_months"),
                changed_by=updated_by or DEFAULT_CHANGED_BY,
            ),
        )
        setting = _fetch_uplift(conn, new_id)

    return {"changed": True, "setting": setting}


def _voucher_key(label: str) -> str:
    # Extra vouchers ("$5 off $50") get their own key next to the standard one.
    slug = "_".join("".join(c if c.isalnum() else " " for c in label.lower()).split())
    return f"{rules.VOUCHER_KEY}_{slug}"[:50]


def add_mechanic(
    kind: str,
    mechanic_label: str,
    effective_discount_pct: Decimal | None = None,
    uplift_pct: Decimal | None = None,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict:
    """
    A new mechanic (or voucher) for all customers. A promotion's key is read
    from its label with the same pattern rule as the promotions data, so it
    matches the promotions that use it, and its discount defaults to the one
    the label implies. No uplift typed = a rule-based uplift that follows
    the rule and each customer's anchor; a typed uplift is an estimate.
    """

    if kind == "voucher":
        key = _voucher_key(mechanic_label)
        discount = effective_discount_pct
    else:
        key = rules.mechanic_key(mechanic_label)
        if key is None or key == rules.VOUCHER_KEY:
            raise ValueError(
                f'"{mechanic_label}" cannot be read as a mechanic; use a form like "35% Off", '
                '"Buy 2 Get 30% Off" or "Buy 3 Get 1 Free".'
            )
        discount = effective_discount_pct if effective_discount_pct is not None else rules.effective_discount(key)

    if uplift_pct is None and discount is None:
        raise ValueError("A voucher with no discount needs an uplift.")

    with common.get_engine().begin() as conn:
        rows = _current_uplift_rows(conn)
        taken = any(
            row["scope"] == "all"
            and (row["mechanic_key"] == key or row["mechanic_label"].lower() == mechanic_label.lower())
            for row in rows
        )
        if taken:
            raise UpliftSettingConflictError(f'"{mechanic_label}" already exists; edit that one instead.')

        rule_based = uplift_pct is None
        new_id = _insert_uplift(
            conn,
            {
                "mechanic_key": key,
                "mechanic_label": mechanic_label,
                "effective_discount_pct": discount,
                "scope": "all",
                "customer_id": None,
                "sku_range": None,
                "sku": None,
                "uplift_pct": (
                    rules.rule_based_uplift(discount, rules.FALLBACK_ANCHOR_PCT, _current_rate(conn))
                    if rule_based
                    else uplift_pct
                ),
                "source": "rule_based" if rule_based else "estimate",
                "kind": kind,
                "evidence_months": None,
                "note": note,
                "changed_by": updated_by or DEFAULT_CHANGED_BY,
                "archived_at": None,
            },
        )
        setting = _fetch_uplift(conn, new_id)

    return {"changed": True, "setting": setting}


# ============================================================
# THE RULE (promo_rule_settings)
#
# One rate for all customers: assume sales rise this many percent for every
# percentage point of discount deeper than the customer's normal (anchor)
# discount. Append-only like the anchors. A high rate is allowed but warned
# about; every rule-based uplift is kept within -90..+300 where it is used.
# ============================================================

# Above this rate, saving still works but answers with a warning.
RULE_WARNING_ABOVE_PCT = Decimal("1.0")
RULE_WARNING = "This is much higher than the default 0.4% per point. Check the preview before saving."


def _current_rule_row(conn: Connection) -> dict | None:
    row = conn.execute(
        text(
            """
            SELECT
                id,
                uplift_per_point_pct,
                changed_by,
                changed_at

            FROM promo_rule_settings

            WHERE
                superseded_at IS NULL
            """
        )
    ).mappings().first()

    return dict(row) if row is not None else None


def _current_rate(conn: Connection) -> Decimal:
    row = _current_rule_row(conn)
    return Decimal(row["uplift_per_point_pct"]) if row is not None else rules.DEFAULT_UPLIFT_PER_POINT_PCT


def _rule_view(row: dict | None) -> dict:
    rate = Decimal(row["uplift_per_point_pct"]) if row is not None else rules.DEFAULT_UPLIFT_PER_POINT_PCT
    return {
        "uplift_per_point_pct": _num(rate),
        "default_uplift_per_point_pct": _num(rules.DEFAULT_UPLIFT_PER_POINT_PCT),
        "is_default": rate == rules.DEFAULT_UPLIFT_PER_POINT_PCT,
        "warning": RULE_WARNING if rate > RULE_WARNING_ABOVE_PCT else None,
        "changed_by": row["changed_by"] if row is not None else None,
        "changed_at": common.iso(row["changed_at"]) if row is not None else None,
    }


def _rule_history(conn: Connection) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                id,
                uplift_per_point_pct,
                changed_by,
                changed_at,
                superseded_at

            FROM promo_rule_settings

            ORDER BY
                changed_at DESC,
                id DESC
            """
        )
    ).mappings().all()

    return [
        {
            "id": row["id"],
            "uplift_per_point_pct": _num(row["uplift_per_point_pct"]),
            "changed_by": row["changed_by"],
            "changed_at": common.iso(row["changed_at"]),
            "is_current": row["superseded_at"] is None,
        }
        for row in rows
    ]


def get_rule() -> dict:
    """The current rate (with whether it is the default and any warning) and every version, newest first."""

    with common.read_connection() as conn:
        rule = _rule_view(_current_rule_row(conn))
        history = _rule_history(conn)

    return {**rule, "history": history}


def _write_rule(uplift_per_point_pct: Decimal, updated_by: str | None) -> dict:
    with common.get_engine().begin() as conn:
        current = conn.execute(
            text(
                """
                SELECT
                    id,
                    uplift_per_point_pct

                FROM promo_rule_settings

                WHERE
                    superseded_at IS NULL

                FOR UPDATE
                """
            )
        ).mappings().first()

        changed = current is None or Decimal(current["uplift_per_point_pct"]) != Decimal(uplift_per_point_pct)
        if changed:
            conn.execute(
                text(
                    """
                    UPDATE promo_rule_settings

                    SET
                        superseded_at = now()

                    WHERE
                        superseded_at IS NULL
                    """
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO promo_rule_settings (
                        uplift_per_point_pct,
                        changed_by
                    )
                    VALUES (
                        CAST(:uplift_per_point_pct AS numeric(6, 2)),
                        :changed_by
                    )
                    """
                ),
                {"uplift_per_point_pct": uplift_per_point_pct, "changed_by": updated_by or DEFAULT_CHANGED_BY},
            )

        rule = _rule_view(_current_rule_row(conn))

    return {"changed": changed, "rule": rule, "warning": rule["warning"]}


def set_rule(uplift_per_point_pct: Decimal, updated_by: str | None = None) -> dict:
    """
    Save a new rate as a new version. `changed` is False when it already is
    that rate; `warning` is set when the rate is above 1.0 (saved anyway).
    """

    if Decimal(uplift_per_point_pct) <= 0:
        raise ValueError("The rate must be more than 0% per point.")
    return _write_rule(Decimal(uplift_per_point_pct), updated_by)


def reset_rule(updated_by: str | None = None) -> dict:
    """Back to the default 0.4% per point, as a new version (nothing written when it already is)."""

    return _write_rule(rules.DEFAULT_UPLIFT_PER_POINT_PCT, updated_by)
