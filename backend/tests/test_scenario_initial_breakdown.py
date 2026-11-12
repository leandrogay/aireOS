from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.scenario import initial_breakdown as service
from app.services.scenario import tier0_breakdown


CUTOFF = date(2026, 10, 1)
ANCHOR = {"version_id": 1, "effective_from": None, "mechanic_key": "pct_off_20",
          "mechanic_label": "20% Off", "anchor_pct": Decimal("20")}


def _initial(units=110, sku="A", month="2027-01-01"):
    return {"customer_id": 1, "sku": sku, "month_year": month, "forecast_initial": units,
            "initial_generated_at": "2026-11-01T00:00:00+00:00"}


def _promotion(month, mechanic="45% Off", sku="A", promotion_id=1):
    from calendar import monthrange
    return {"customer_id": 1, "sku": sku, "promotion_id": promotion_id, "promo_type": "monthly",
            "period_start": month, "period_end": month.replace(day=monthrange(month.year, month.month)[1]),
            "promotion_mechanic": mechanic}


def _install(monkeypatch, history=None, promotions=None):
    history = history or {(1, "A"): {date(2026, month, 1): 110 for month in [1, 8, 9, 10]}}
    promotions = promotions if promotions is not None else [_promotion(month) for month in history[(1, "A")]]
    inputs = {"promotions": promotions, "moments": [], "sku_ranges": {"A": "Pants", "B": "Tape"},
              "anchor_for": lambda *_: dict(ANCHOR),
              "discount_in": lambda key, month: Decimal("45") if key == "pct_off_45" else Decimal("20")}
    monkeypatch.setattr(service.bigquery, "resolve_forecast_scope", lambda **_: {"customer_ids": [1], "skus": None})
    monkeypatch.setattr(service, "_cutoff", lambda year: CUTOFF)
    monkeypatch.setattr(tier0_breakdown, "_history", lambda scope: history)
    monkeypatch.setattr(tier0_breakdown, "_settings_inputs", lambda _: inputs)
    return history, inputs


def test_initial_uses_its_own_cutoff_not_the_newer_current_sales_month(monkeypatch):
    history, inputs = _install(monkeypatch)
    history[(1, "A")][date(2026, 11, 1)] = 99999
    inputs["promotions"].append(_promotion(date(2027, 1, 1), "50% Off", promotion_id=9))

    result = service.get_initial_breakdown(2027, forecast_rows=[_initial()])

    split, = result["rows"]
    assert result["data_cutoff"] == "2026-10-01" and not result["unavailable"]
    assert split["latest_month"] == "2026-10-01"
    assert split["baseline"] == pytest.approx(100)
    assert split["carried"] == pytest.approx(10)
    assert split["last_year"]["anchor"]["anchor_pct"] == 20.0
    assert split["recent"][0]["anchor"]["mechanic_label"] == "20% Off"
    assert split["official"]["planned"] is False
    assert [item["month"] for item in split["recent"]] == ["2026-08-01", "2026-09-01", "2026-10-01"]


def test_measured_uplifts_are_rebuilt_without_later_sales_in_their_baseline(monkeypatch):
    history = {(1, "A"): {date(2026, month, 1): (120 if month in [4, 5, 6] else 100) for month in range(1, 11)}}
    promotions = [_promotion(month, "45% Off" if month.month in [4, 5, 6] else "20% Off", promotion_id=month.month)
                  for month in history[(1, "A")]]
    _, inputs = _install(monkeypatch, history, promotions)
    history[(1, "A")][date(2026, 11, 1)] = 10000
    inputs["moments"] = [{"month": date(2026, 4, 1), "uplift_pct": 999}]

    result = service.get_initial_breakdown(2027, forecast_rows=[_initial(month="2027-04-01")])

    split, = result["rows"]
    assert split["last_year"]["uplift_pct"] == 20
    assert split["last_year"]["level"] == "measured"
    assert split["baseline"] == pytest.approx(100)
    assert split["carried"] == pytest.approx(10)


def test_each_sku_uses_its_own_latest_month_within_the_initial_cutoff(monkeypatch):
    history, _ = _install(monkeypatch)
    history[(1, "B")] = {date(2026, month, 1): 80 for month in [7, 8, 9]}

    result = service.get_initial_breakdown(2027, forecast_rows=[_initial(), _initial(80, "B")])

    assert [row["latest_month"] for row in result["rows"]] == ["2026-10-01", "2026-09-01"]
    assert result["rows"][1]["tier0"] == 80


def test_published_rounding_is_reconciled_without_changing_initial(monkeypatch):
    _install(monkeypatch)
    split, = service.get_initial_breakdown(2027, forecast_rows=[_initial(110.4)])["rows"]
    assert split["reconstructed_tier0"] == 110
    assert split["baseline"] + split["carried"] == 110.4


def test_revised_history_that_no_longer_matches_initial_is_reported_without_a_guessed_split(monkeypatch):
    _install(monkeypatch)
    result = service.get_initial_breakdown(2027, forecast_rows=[_initial(500)])
    assert not result["rows"]
    assert result["unavailable"][0]["sku"] == "A"


def test_missing_initial_origin_never_falls_back_to_current(monkeypatch):
    _install(monkeypatch)
    monkeypatch.setattr(service, "_cutoff", lambda year: None)
    monkeypatch.setattr(tier0_breakdown, "_history", lambda _: pytest.fail("No origin; do not read Current history"))
    result = service.get_initial_breakdown(2027, forecast_rows=[_initial()])
    assert not result["rows"] and result["unavailable"]


def test_nonfinite_history_is_never_published_as_a_valid_split(monkeypatch):
    history, _ = _install(monkeypatch)
    history[(1, "A")][date(2026, 10, 1)] = float("nan")
    result = service.get_initial_breakdown(2027, forecast_rows=[_initial()])
    assert not result["rows"] and result["unavailable"]


def test_unrecognised_historical_promotions_are_not_treated_as_a_zero_uplift_anchor_month(monkeypatch):
    _install(monkeypatch, promotions=[_promotion(date(2026, 10, 1), "Free mystery gift")])
    result = service.get_initial_breakdown(2027, forecast_rows=[_initial()])
    assert not result["rows"]
    assert "Free mystery gift" in result["unavailable"][0]["reason"]


def test_an_unconfigured_explicit_discount_uses_a_labelled_rule_estimate_without_writing_settings(monkeypatch):
    _, inputs = _install(monkeypatch, promotions=[_promotion(date(2026, 10, 1), "33% Off")])
    inputs["discount_in"] = lambda *_: None
    result = service.get_initial_breakdown(2027, forecast_rows=[_initial()])
    split, = result["rows"]
    source = next(item for item in split["recent"] if item["month"] == "2026-10-01")
    assert source["uplift_pct"] == 5
    assert source["level"] == "placeholder"
    assert source["discount_fallbacks"] == {"pct_off_33": 33.0}
    assert not result["unavailable"]


def test_a_configured_historical_discount_wins_over_the_number_in_its_label(monkeypatch):
    _, inputs = _install(monkeypatch, promotions=[_promotion(date(2026, 10, 1), "33% Off")])
    inputs["discount_in"] = lambda *_: Decimal("30")
    source = service.get_initial_breakdown(2027, forecast_rows=[_initial()])["rows"][0]["recent"][-1]
    assert source["uplift_pct"] == 4
    assert source["discount_fallbacks"] == {}


def test_origin_query_binds_the_year_and_reads_the_configured_forecast_dataset(monkeypatch):
    calls = []
    monkeypatch.setattr(service.bigquery, "run_query", lambda query, params: calls.append((query, params)) or [{"data_cutoff": CUTOFF}])
    assert service._cutoff(2027) == CUTOFF
    query, params = calls[0]
    assert "aire_forecasting_initial_meta" in query and "@year" in query
    assert params[0].name == "year" and params[0].value == 2027


def test_initial_route_passes_basis_and_year_and_requires_a_year_before_io(monkeypatch):
    seen = []
    monkeypatch.setattr(service, "get_initial_breakdown", lambda *args: seen.append(args) or {"rows": [], "basis": "initial"})
    client = TestClient(app)
    assert client.get("/api/scenario/tier0-breakdown?basis=initial&year=2027&customer_name=FairPrice").status_code == 200
    assert seen == [(2027, "FairPrice", None)]
    assert client.get("/api/scenario/tier0-breakdown?basis=initial").status_code == 400
    assert client.get("/api/scenario/tier0-breakdown?basis=unknown").status_code == 400
