from datetime import date
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.services import sellout_service, sql


@lru_cache(maxsize=1)
def _get_read_engine() -> Engine:
    return sql.connect_with_connector_autocommit()


def get_monthly_sellout(
    retailer_ids: list[int],
    conn: Connection | None = None,
) -> tuple[dict[str, dict[date, float]], date | None]:
    """
    Actual sell-out units per SKU and month for the given retailers, plus the
    last day the data covers.

    Reads through sellout_service's effective-sellout view, so a retailer+month
    that only has monthly-granularity rows is still counted (not silently
    zero), and a month with both weekly and monthly rows is never
    double-counted. Weekly rows (Thursday to Wednesday) are counted in the
    month they start in, the same rule the dashboard uses. Returns
    ({sku: {first_of_month: units}}, data_through); data_through is None when
    there is no data. A month is only complete once data_through reaches its
    last day.

    `conn` lets a caller already inside a transaction (e.g. a write validating
    sell-out coverage) read without opening a second pooled connection.
    """

    if not retailer_ids:
        return {}, None

    query = text(
        sellout_service.EFFECTIVE_SELLOUT_CTE
        + """
        SELECT
          sku,
          date_trunc('month', period_start)::date AS month,
          SUM(quantity_units) AS units,
          MAX(period_end) AS data_through
        FROM effective_sellout
        WHERE retailer_id = ANY(CAST(:retailer_ids AS integer[]))
        GROUP BY sku, month
        """
    )
    params = {"retailer_ids": retailer_ids}

    if conn is not None:
        rows = conn.execute(query, params).mappings().all()
    else:
        with _get_read_engine().connect() as read_conn:
            rows = read_conn.execute(query, params).mappings().all()

    units: dict[str, dict[date, float]] = {}
    data_through = None
    for row in rows:
        # Every row in a group has a non-null quantity_units today (verified
        # live), but SUM() over an all-NULL group is NULL, not 0 -- fall back
        # rather than crash if that ever changes.
        units.setdefault(row["sku"], {})[row["month"]] = (
            float(row["units"]) if row["units"] is not None else 0.0
        )

        through = row["data_through"]
        if data_through is None or through > data_through:
            data_through = through

    return units, data_through
