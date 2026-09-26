from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.settings import common
from app.services.settings.common import CustomerNotFoundError


# DOH settings for one customer: versioned thresholds (doh_settings) and
# the alert toggle (customers.doh_alert_*). Customer lookups, locking and
# the engines are shared with other kinds of settings in common.py.


# ============================================================
# Custom Exceptions
# ============================================================


class SettingVersionNotFoundError(Exception):
    pass


# ============================================================
# CURRENT SETTINGS
#
# current_settings has one row per customer (LEFT JOIN LATERAL onto the
# newest doh_settings row), so the "latest version" rule lives in the
# view, not here. A customer with no thresholds has NULL threshold fields.
# ============================================================

_CURRENT_SETTINGS_SQL = """
    SELECT
        customer_id,
        customer_name,
        doh_alert_enabled,
        doh_alert_updated_at,
        setting_id,
        min_doh,
        target_doh,
        max_doh,
        thresholds_updated_at,
        thresholds_updated_by

    FROM current_settings
"""


def _settings_view(row: dict) -> dict:
    return {
        "customer_id": row["customer_id"],
        "customer_name": row["customer_name"],
        "doh_alert_enabled": row["doh_alert_enabled"],
        "doh_alert_updated_at": common.iso(row["doh_alert_updated_at"]),
        "setting_id": row["setting_id"],
        "min_doh": row["min_doh"],
        "target_doh": row["target_doh"],
        "max_doh": row["max_doh"],
        "thresholds_updated_at": common.iso(row["thresholds_updated_at"]),
        "thresholds_updated_by": row["thresholds_updated_by"],
    }


def _fetch_current(conn: Connection, customer_id: int) -> dict | None:
    row = conn.execute(
        text(
            f"""
            {_CURRENT_SETTINGS_SQL}

            WHERE
                customer_id = :customer_id
            """
        ),
        {"customer_id": customer_id},
    ).mappings().first()

    return dict(row) if row is not None else None


def list_settings() -> list[dict]:
    """Every customer's alert flag and current thresholds, by customer name."""

    with common.read_connection() as conn:
        rows = conn.execute(
            text(
                f"""
                {_CURRENT_SETTINGS_SQL}

                ORDER BY
                    customer_name ASC
                """
            )
        ).mappings().all()

    return [_settings_view(dict(row)) for row in rows]


def get_settings(customer_id: int) -> dict:
    with common.read_connection() as conn:
        row = _fetch_current(conn, customer_id)

    if row is None:
        raise CustomerNotFoundError(f"Customer {customer_id} does not exist.")
    return _settings_view(row)


# ============================================================
# THRESHOLD VERSIONS
#
# doh_settings is append-only: a change is always an INSERT, never an
# UPDATE or DELETE, and the newest row per customer (updated_at DESC,
# setting_id DESC) is the current setting. The insert only happens when
# min/target/max differ from the current version, and that check runs in
# the database, so "no row returned" means nothing changed.
# ============================================================

# Values are cast to the column type so the comparison with the stored
# NUMERIC(6,2) values is exact (the schemas already limit input to 2 dp).
_INSERT_VERSION_SQL = """
    INSERT INTO doh_settings (
        customer_id,
        min_doh,
        target_doh,
        max_doh,
        updated_by
    )
    SELECT
        CAST(:customer_id AS integer),
        CAST(:min_doh AS numeric(6, 2)),
        CAST(:target_doh AS numeric(6, 2)),
        CAST(:max_doh AS numeric(6, 2)),
        CAST(:updated_by AS text)

    WHERE NOT EXISTS (
        SELECT 1

        FROM (
            SELECT
                min_doh,
                target_doh,
                max_doh

            FROM doh_settings

            WHERE
                customer_id = CAST(:customer_id AS integer)

            ORDER BY
                updated_at DESC,
                setting_id DESC

            LIMIT 1
        ) cur

        WHERE
            (cur.min_doh, cur.target_doh, cur.max_doh) = (
                CAST(:min_doh AS numeric(6, 2)),
                CAST(:target_doh AS numeric(6, 2)),
                CAST(:max_doh AS numeric(6, 2))
            )
    )

    RETURNING setting_id
"""


def _insert_version(
    conn: Connection,
    customer_id: int,
    min_doh: Decimal,
    target_doh: Decimal,
    max_doh: Decimal,
    updated_by: str | None,
) -> bool:
    """Append a version unless it equals the current one; True when a row was written."""

    row = conn.execute(
        text(_INSERT_VERSION_SQL),
        {
            "customer_id": customer_id,
            "min_doh": min_doh,
            "target_doh": target_doh,
            "max_doh": max_doh,
            "updated_by": updated_by,
        },
    ).first()

    return row is not None


def save_thresholds(
    customer_id: int,
    min_doh: Decimal,
    target_doh: Decimal,
    max_doh: Decimal,
    updated_by: str | None = None,
) -> dict:
    """
    Save a customer's thresholds as a new version, in one transaction.
    `changed` is False when the values equal the current version, in which
    case nothing is written.
    """

    with common.get_engine().begin() as conn:
        common.lock_customer(conn, customer_id)
        changed = _insert_version(conn, customer_id, min_doh, target_doh, max_doh, updated_by)
        current = _fetch_current(conn, customer_id)

    return {"changed": changed, "settings": _settings_view(current)}


def revert_to_version(customer_id: int, setting_id: int, updated_by: str | None = None) -> dict:
    """
    Make an older version current again by inserting a copy of its values as
    a new version; the old row is left as it is. Goes through the same
    conditional insert, so reverting to values that are already current
    writes nothing (`changed` False).
    """

    with common.get_engine().begin() as conn:
        common.lock_customer(conn, customer_id)

        version = conn.execute(
            text(
                """
                SELECT
                    min_doh,
                    target_doh,
                    max_doh

                FROM doh_settings

                WHERE
                    setting_id = :setting_id
                    AND customer_id = :customer_id
                """
            ),
            {"setting_id": setting_id, "customer_id": customer_id},
        ).mappings().first()

        if version is None:
            raise SettingVersionNotFoundError(
                f"Setting version {setting_id} does not exist for customer {customer_id}."
            )

        changed = _insert_version(
            conn,
            customer_id,
            version["min_doh"],
            version["target_doh"],
            version["max_doh"],
            updated_by,
        )
        current = _fetch_current(conn, customer_id)

    return {"changed": changed, "settings": _settings_view(current)}


def get_history(customer_id: int, limit: int, offset: int) -> dict:
    """
    One page of a customer's threshold versions, newest first, with the total
    count for paging. `is_current` marks the version the view reports as
    current.
    """

    with common.read_connection() as conn:
        current = _fetch_current(conn, customer_id)
        if current is None:
            raise CustomerNotFoundError(f"Customer {customer_id} does not exist.")

        total = conn.execute(
            text(
                """
                SELECT
                    COUNT(*) AS total

                FROM doh_settings

                WHERE
                    customer_id = :customer_id
                """
            ),
            {"customer_id": customer_id},
        ).mappings().first()["total"]

        rows = conn.execute(
            text(
                """
                SELECT
                    setting_id,
                    min_doh,
                    target_doh,
                    max_doh,
                    updated_at,
                    updated_by

                FROM doh_settings

                WHERE
                    customer_id = :customer_id

                ORDER BY
                    updated_at DESC,
                    setting_id DESC

                LIMIT :limit
                OFFSET :offset
                """
            ),
            {"customer_id": customer_id, "limit": limit, "offset": offset},
        ).mappings().all()

    items = [
        {
            "setting_id": row["setting_id"],
            "min_doh": row["min_doh"],
            "target_doh": row["target_doh"],
            "max_doh": row["max_doh"],
            "updated_at": common.iso(row["updated_at"]),
            "updated_by": row["updated_by"],
            "is_current": row["setting_id"] == current["setting_id"],
        }
        for row in rows
    ]

    return {
        "customer_id": customer_id,
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
    }


# ============================================================
# DOH ALERT
#
# The alert flag lives on customers and is changed in place; it never
# creates a doh_settings version. doh_alert_updated_at only moves when the
# value actually changes (the WHERE skips an unchanged row).
# ============================================================


def set_alert(customer_id: int, enabled: bool) -> dict:
    with common.get_engine().begin() as conn:
        common.lock_customer(conn, customer_id)

        row = conn.execute(
            text(
                """
                UPDATE customers

                SET
                    doh_alert_enabled = CAST(:enabled AS boolean),
                    doh_alert_updated_at = now()

                WHERE
                    customer_id = :customer_id
                    AND doh_alert_enabled IS DISTINCT FROM CAST(:enabled AS boolean)

                RETURNING customer_id
                """
            ),
            {"customer_id": customer_id, "enabled": enabled},
        ).first()

        current = _fetch_current(conn, customer_id)

    return {"changed": row is not None, "settings": _settings_view(current)}
