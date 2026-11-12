from contextlib import nullcontext
from datetime import date

from conftest import FakeConnection

from app.services import sellout_units
from app.services.settings import common
from app.services.settings import promo_moments as service


def _promo(promotion_id, month, mechanic):
    return {
        "customer_id": 1,
        "sku": "SKU-L",
        "promotion_id": promotion_id,
        "period_start": month,
        "period_end": month.replace(day=28 if month.month == 2 else 31),
        "promo_type": "monthly",
        "promotion_mechanic": mechanic,
    }


def _install_inputs(monkeypatch, units, data_through):
    seen = {}

    def fake_sellout(retailer_ids, conn):
        seen["retailer_ids"] = retailer_ids
        return {"SKU-L": units}, data_through

    def fake_retailers(conn, customer_id=None):
        seen["retailers_for"] = customer_id
        return {1: [11]}

    def fake_promotions(conn, customer_id=None):
        seen["promotions_for"] = customer_id
        return [_promo(1, date(2026, 1, 1), "20% Off")]

    monkeypatch.setattr(service, "_offline_retailers", fake_retailers)
    monkeypatch.setattr(service, "_offline_promotions", fake_promotions)
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", fake_sellout)
    return seen


# ---- customer_inputs (read by promo_recalc) ----------------------------------------


def test_inputs_read_only_that_customers_offline_retailers_and_promotions(monkeypatch):
    units = {date(2026, 1, 1): 100.0, date(2026, 2, 1): 120.0}
    seen = _install_inputs(monkeypatch, units, date(2026, 2, 28))

    inputs = service.customer_inputs(object(), 1)

    assert (seen["retailers_for"], seen["promotions_for"], seen["retailer_ids"]) == (1, 1, [11])
    assert inputs["units"] == {(1, "SKU-L"): units}


def test_a_month_the_data_does_not_yet_cover_is_left_out_and_is_not_a_sales_month(monkeypatch):
    units = {date(2026, 1, 1): 100.0, date(2026, 2, 1): 120.0, date(2026, 3, 1): 40.0}
    _install_inputs(monkeypatch, units, date(2026, 3, 12))

    inputs = service.customer_inputs(object(), 1)

    assert sorted(inputs["units"][(1, "SKU-L")]) == [date(2026, 1, 1), date(2026, 2, 1)]
    assert inputs["sales_through"] == date(2026, 2, 1)


def test_data_reaching_a_months_last_day_completes_that_month():
    assert service._last_complete_month(date(2026, 3, 31)) == date(2026, 3, 1)
    assert service._last_complete_month(date(2026, 1, 15)) == date(2025, 12, 1)
    assert service._last_complete_month(None) is None


# ---- list_moments (reads promo_moment_calc) ----------------------------------------


def _calc_row(month, mechanic_key, uplift, is_baseline=False):
    return {
        "customer_id": 1,
        "sku": "SKU-L",
        "month": month,
        "promotion_id": month.month,
        "mechanic_key": mechanic_key,
        "mechanic_label": mechanic_key,
        "units": 100,
        "anchor_id": 7,
        "version_from": None,
        "baseline_mechanic_key": "pct_off_20",
        "baseline_units": 100,
        "baseline_source": "version",
        "baseline_months": [date(2026, 1, 1)],
        "is_baseline": is_baseline,
        "uplift_pct": uplift,
    }


def _install_calc(monkeypatch, rows):
    def respond(sql, params):
        if "FROM promo_moment_calc" in sql:
            assert "NOT planned" in sql
            return rows
        if "LEFT JOIN promo_calc_status" in sql:
            return [{"customer_id": 1, "calculated_at": None, "warnings": [], "last_error": None,
                     "last_error_at": None, "pending": True}]
        if "FROM skus" in sql:
            return [{"sku": "SKU-L", "product_name": "Aire Pants L", "sku_range": "Pants"}]
        if "FROM customers" in sql:
            return [{"customer_id": 1, "customer_name": "fairprice"}]
        return []

    conn = FakeConnection(respond)
    monkeypatch.setattr(common, "read_connection", lambda: nullcontext(conn))
    return conn


def test_moments_come_from_the_worked_out_table_named_with_their_version(monkeypatch):
    conn = _install_calc(monkeypatch, [
        _calc_row(date(2026, 1, 1), "pct_off_20", 0.0, is_baseline=True),
        _calc_row(date(2026, 3, 1), "pct_off_30", 20.0),
    ])

    result = service.list_moments()
    march = result["moments"][-1]

    assert march["month"] == "2026-03-01"
    assert (march["customer_name"], march["product_name"], march["sku_range"]) == ("fairprice", "Aire Pants L", "Pants")
    assert (march["anchor_id"], march["baseline_source"], march["baseline_months"]) == (7, "version", ["2026-01-01"])
    assert march["uplift_pct"] == 20.0
    # A page load never reads sell-out.
    assert not conn.sql_containing("sellout")


def test_recommendations_are_worked_out_from_the_stored_moments(monkeypatch):
    _install_calc(monkeypatch, [_calc_row(date(2026, 3, 1), "pct_off_30", 20.0)])

    thirty = next(r for r in service.list_moments()["recommendations"] if r["mechanic_key"] == "pct_off_30")

    # One 30% Off moment: too few to recommend from.
    assert (thirty["recommended_uplift_pct"], thirty["enough_data"]) == (None, False)


def test_each_customers_calculation_status_comes_back(monkeypatch):
    _install_calc(monkeypatch, [])

    assert service.list_moments()["calc_status"] == {
        "1": {"calculated_at": None, "pending": True, "warnings": [], "last_error": None, "last_error_at": None},
    }
