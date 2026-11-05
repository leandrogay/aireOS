from contextlib import nullcontext
from datetime import date

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


def _install(monkeypatch, units, data_through, baselines=None):
    seen = {}

    def fake_sellout(retailer_ids, conn):
        seen["retailer_ids"] = retailer_ids
        return {"SKU-L": units}, data_through

    promotions = [
        _promo(1, date(2026, 1, 1), "20% Off"),
        _promo(2, date(2026, 2, 1), "20% Off"),
        _promo(3, date(2026, 3, 1), "30% Off"),
    ]
    monkeypatch.setattr(common, "read_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(service, "_offline_retailers", lambda conn: {1: [11]})
    monkeypatch.setattr(service, "_offline_promotions", lambda conn: promotions)
    monkeypatch.setattr(service, "_customer_names", lambda conn: {1: "fairprice"})
    monkeypatch.setattr(service, "_products", lambda conn: {"SKU-L": {"product_name": "Aire Pants L", "sku_range": "Pants"}})
    monkeypatch.setattr(sellout_units, "get_monthly_sellout", fake_sellout)
    monkeypatch.setattr(service, "_saved_baselines", lambda conn: baselines or {})
    return seen


# ---- list_moments ------------------------------------------------------------------


def test_moments_read_only_the_customers_offline_retailers(monkeypatch):
    units = {date(2026, 1, 1): 100.0, date(2026, 2, 1): 120.0, date(2026, 3, 1): 132.0}
    seen = _install(monkeypatch, units, date(2026, 3, 31))

    service.list_moments()

    assert seen["retailer_ids"] == [11]


def test_moments_come_back_named_and_measured(monkeypatch):
    units = {date(2026, 1, 1): 100.0, date(2026, 2, 1): 120.0, date(2026, 3, 1): 132.0}
    _install(monkeypatch, units, date(2026, 3, 31))

    result = service.list_moments()
    march = result["moments"][-1]
    thirty = next(r for r in result["recommendations"] if r["mechanic_key"] == "pct_off_30")

    assert result["baseline_method"] == "common_discount"
    assert march["month"] == "2026-03-01"
    assert (march["customer_name"], march["product_name"], march["sku_range"]) == ("fairprice", "Aire Pants L", "Pants")
    assert march["uplift_pct"] == 20.0
    # One 30% Off moment: too few to recommend from.
    assert thirty["recommended_uplift_pct"] is None
    assert thirty["enough_data"] is False


def test_a_month_the_data_does_not_yet_cover_is_left_out(monkeypatch):
    units = {date(2026, 1, 1): 100.0, date(2026, 2, 1): 120.0, date(2026, 3, 1): 40.0}
    _install(monkeypatch, units, date(2026, 3, 12))

    result = service.list_moments()

    assert [m["month"] for m in result["moments"]] == ["2026-01-01", "2026-02-01"]


def test_a_saved_anchor_is_the_baseline_even_when_it_is_not_the_most_common(monkeypatch):
    units = {date(2026, 1, 1): 100.0, date(2026, 2, 1): 120.0, date(2026, 3, 1): 132.0}
    _install(monkeypatch, units, date(2026, 3, 31), baselines={(1, "Pants"): "pct_off_30"})

    moments = service.list_moments()["moments"]

    assert {m["baseline_mechanic_key"] for m in moments} == {"pct_off_30"}
    assert moments[0]["uplift_pct"] == round((100 / 132 - 1) * 100, 2)
