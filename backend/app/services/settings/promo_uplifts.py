from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.settings import common
from app.services.settings import promo_uplift_rules as rules
from app.services.settings.common import CustomerNotFoundError


# Promotion Uplift Settings: the uplift per promotion mechanic
# (promo_uplift_settings) and each customer's ordinary-month discount, the
# "anchor" that placeholder uplifts are measured from (promo_anchor_settings).
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
    s.evidence_months,
    s.note,
    s.changed_by,
    s.changed_at,
    s.superseded_at
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
        # Placeholder values with a discount are recalculated from each
        # customer's anchor; every other value is used as stored.
        "follows_anchor": row["source"] == "placeholder" and row["effective_discount_pct"] is not None,
        "evidence_months": row["evidence_months"],
        "note": row["note"],
        "changed_by": row["changed_by"],
        "changed_at": common.iso(row["changed_at"]),
        "superseded_at": common.iso(row["superseded_at"]),
    }


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


def _promotions_by_customer(conn: Connection, customer_id: int | None = None) -> dict[int, list[dict]]:
    """
    Every promotion on any of a customer's channels (customer_retailers maps
    fairprice to fairprice_offline and fairprice_online), once per customer.
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
                p.promotion_mechanic

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

    by_customer: dict[int, list[dict]] = {}
    for row in rows:
        by_customer.setdefault(row["customer_id"], []).append(dict(row))
    return by_customer


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
) -> dict:
    suggestion = rules.suggest_anchor(rules.monthly_discounts(promotions, discount_by_key))
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

    return [
        _anchor_view(customer, anchor_rows, promotions.get(customer["customer_id"], []), discount_by_key)
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
    """Every current uplift row, the all-customers anchor, and promotion mechanics that match none."""

    with common.read_connection() as conn:
        uplift_rows = _current_uplift_rows(conn)
        default = _default_anchor(_current_anchor_rows(conn))
        unmapped = _unmapped_mechanics(conn, {row["mechanic_key"] for row in uplift_rows})

    return {
        "settings": [_uplift_view(row) for row in uplift_rows],
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
            """
        )
    ).mappings().all()

    return [dict(row) for row in rows]


def _pick_uplifts(
    uplift_rows: list[dict],
    customer_id: int,
    sku: str | None,
    sku_range: str | None,
    anchor_pct: Decimal,
) -> list[dict]:
    """Most specific current row per mechanic, with placeholders recalculated from the anchor."""

    chosen: dict[str, dict] = {}
    for row in uplift_rows:
        if not _applies(row, customer_id, sku, sku_range):
            continue
        current = chosen.get(row["mechanic_key"])
        if current is None or _SCOPE_ORDER.index(row["scope"]) < _SCOPE_ORDER.index(current["scope"]):
            chosen[row["mechanic_key"]] = row

    uplifts = []
    for row in chosen.values():
        view = _uplift_view(row)
        if view["follows_anchor"]:
            view["uplift_pct"] = _num(rules.placeholder_uplift(row["effective_discount_pct"], anchor_pct))
        uplifts.append(view)

    uplifts.sort(key=lambda view: (view["effective_discount_pct"] is None, view["effective_discount_pct"] or 0))
    return uplifts


def resolve_uplifts(customer_name: str, product_name: str | None = None) -> dict:
    """
    The uplift of every mechanic for one customer and product (None = all
    SKUs), as the Scenario builder uses it: the most specific current row
    (SKU, range, customer, all), with placeholder values recalculated from
    the customer's anchor.

    For all SKUs, `product_uplifts` also lists the products whose own (SKU or
    range) value differs from the customer's, as {product_name: {mechanic_key:
    uplift_pct}}, so an all-SKUs promotion can apply each product's value.
    """

    with common.read_connection() as conn:
        customer = _customer_by_name(conn, customer_name)
        anchor = _anchors(conn, customer["customer_id"])[0]
        product = _sku_for_product(conn, product_name) if product_name else {"sku": None, "sku_range": None}
        uplift_rows = _current_uplift_rows(conn)

        has_product_rows = any(
            row["scope"] in ("range", "sku") and row["customer_id"] == customer["customer_id"]
            for row in uplift_rows
        )
        products = _products(conn) if product_name is None and has_product_rows else []

    anchor_pct = Decimal(str(anchor["anchor_pct"]))
    uplifts = _pick_uplifts(uplift_rows, customer["customer_id"], product["sku"], product["sku_range"], anchor_pct)

    customer_values = {view["mechanic_key"]: view["uplift_pct"] for view in uplifts}
    product_uplifts: dict[str, dict[str, float]] = {}
    for item in products:
        own = _pick_uplifts(uplift_rows, customer["customer_id"], item["sku"], item["sku_range"], anchor_pct)
        differing = {
            view["mechanic_key"]: view["uplift_pct"]
            for view in own
            if view["uplift_pct"] != customer_values.get(view["mechanic_key"])
        }
        if differing:
            product_uplifts[item["product_name"]] = differing

    return {
        "customer_name": customer["customer_name"],
        "product_name": product_name,
        "anchor": anchor,
        "uplifts": uplifts,
        "product_uplifts": product_uplifts,
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
# longer follows the anchor; reset puts it back on the placeholder rule.
# Learned values belong to the forecasting model and cannot be edited here.
# ============================================================


def _lock_current_row(conn: Connection, setting_id: int) -> dict:
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
                note,
                changed_by
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
                :note,
                :changed_by
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


def _seed_placeholder(conn: Connection, mechanic_key: str) -> Decimal | None:
    # The voucher has no discount to calculate from, so its placeholder is
    # the latest placeholder value it was given.
    row = conn.execute(
        text(
            """
            SELECT
                uplift_pct

            FROM promo_uplift_settings

            WHERE
                mechanic_key = :mechanic_key
                AND scope = 'all'
                AND source = 'placeholder'

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
    Undo a typed value. An all-customers row goes back on the placeholder
    rule; a customer, range or SKU row is retired, so the broader value
    applies again. `changed` is False when it is already a placeholder.
    """

    with common.get_engine().begin() as conn:
        row = _lock_current_row(conn, setting_id)

        if row["source"] == "placeholder":
            return {"changed": False, "setting": _uplift_view(row)}

        _supersede_uplift(conn, setting_id)
        if row["scope"] != "all":
            return {"changed": True, "setting": None}

        if row["effective_discount_pct"] is not None:
            uplift_pct = rules.placeholder_uplift(row["effective_discount_pct"], rules.FALLBACK_ANCHOR_PCT)
        else:
            uplift_pct = _seed_placeholder(conn, row["mechanic_key"])
            if uplift_pct is None:
                raise UpliftSettingConflictError(f"{row['mechanic_label']} has no placeholder value to go back to.")

        new_id = _insert_uplift(
            conn,
            _copy(row, uplift_pct=uplift_pct, note=None, source="placeholder", changed_by=updated_by or DEFAULT_CHANGED_BY),
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
        base = next((row for row in rows if row["mechanic_key"] == mechanic_key and row["scope"] == "all"), None)
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
