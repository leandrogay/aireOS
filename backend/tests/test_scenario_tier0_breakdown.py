from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from google.api_core.exceptions import GoogleAPICallError

from app.main import app
from app.services import bigquery
from app.services.scenario import tier0_breakdown as service


class FakeBigQueryClient:
    """Records the query and its parameters, returns canned training rows."""

    def __init__(self, rows):
        self._rows = rows
        self.last_query = None
        self.last_job_config = None

    def query(self, query, job_config=None):
        self.last_query = query
        self.last_job_config = job_config
        return self

    def result(self):
        return self._rows


def _params_by_name(job_config) -> dict:
    return {param.name: param.values for param in job_config.query_parameters}


def _anchor_for(customer_id, sku_range, month):
    # One saved anchor version, 20% Off from the start.
    return {"version_id": 1, "effective_from": None, "mechanic_key": "pct_off_20",
            "mechanic_label": "20% Off", "anchor_pct": Decimal("20")}


def _inputs(promotions):
    return {
        "promotions": promotions,
        "moments": [],
        "sku_ranges": {"SKU-1": "Pants"},
        "anchor_for": _anchor_for,
        # 30% Off is 30% in every month: the placeholder rule gives +4 at a 20% anchor.
        "discount_in": lambda key, month: Decimal("30") if key == "pct_off_30" else None,
    }


def _install(monkeypatch, rows, promotions=()):
    client = FakeBigQueryClient(rows)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: client)
    monkeypatch.setattr(bigquery, "resolve_forecast_scope", lambda **_: {"customer_ids": [1], "skus": ["SKU-1"]})
    monkeypatch.setattr(service, "_settings_inputs", lambda customer_ids: _inputs(list(promotions)))
    return client


def _training(month, cartons):
    return {"customer_id": 1, "sku": "SKU-1", "month_year": month, "quantity_cartons": cartons}


def _promotion(mechanic, start, end):
    return {"customer_id": 1, "sku": "SKU-1", "promotion_id": 1, "period_start": start, "period_end": end,
            "promo_type": "monthly", "promotion_mechanic": mechanic}


# ---- the read -----------------------------------------------------------------


def test_the_training_input_is_read_for_the_scope_only(monkeypatch):
    client = _install(monkeypatch, [_training(date(2026, 5, 1), 100.0)])

    service.get_tier0_breakdown(customer_name="FairPrice", sku_range="Pants")

    assert "fc_training_input" in client.last_query
    assert _params_by_name(client.last_job_config) == {"customer_ids": [1], "skus": ["SKU-1"]}


def test_an_empty_scope_answers_without_querying(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery must not be queried")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)
    monkeypatch.setattr(bigquery, "resolve_forecast_scope", lambda **_: {"customer_ids": [], "skus": None})

    assert service.get_tier0_breakdown(customer_name="nobody") == {"rows": []}


# ---- the rows -----------------------------------------------------------------


def test_every_forecast_month_after_the_latest_gets_a_split(monkeypatch):
    _install(monkeypatch, [_training(date(2026, 5, 1), 100.0)])

    rows = service.get_tier0_breakdown()["rows"]

    assert [row["month_year"] for row in rows][:2] == ["2026-06-01", "2026-07-01"]
    assert len(rows) == 15
    assert rows[0]["latest_month"] == "2026-05-01"


def test_a_placeholder_uplift_uses_the_discount_and_anchor_of_its_month(monkeypatch):
    _install(
        monkeypatch,
        [_training(date(2025, 6, 1), 104.0), _training(date(2026, 5, 1), 100.0)],
        [_promotion("30% Off", date(2025, 6, 1), date(2025, 6, 30))],
    )

    june = service.get_tier0_breakdown()["rows"][0]

    assert june["last_year"]["promotions"][0]["level"] == "placeholder"
    assert june["last_year"]["uplift_pct"] == 4
    assert june["baseline"] == 0.5 * 100 + 0.5 * 100
    assert june["carried"] == 2


def test_the_anchor_mechanic_carries_nothing(monkeypatch):
    _install(
        monkeypatch,
        [_training(date(2026, 5, 1), 100.0)],
        [_promotion("20% Off", date(2026, 5, 1), date(2026, 5, 31))],
    )

    june = service.get_tier0_breakdown()["rows"][0]

    assert june["recent"][0]["promotions"][0]["level"] == "anchor"
    assert june["carried"] == 0


# ---- the route ----------------------------------------------------------------


def test_the_route_returns_the_rows(monkeypatch):
    monkeypatch.setattr(service, "get_tier0_breakdown", lambda **_: {"rows": []})

    response = TestClient(app).get("/api/scenario/tier0-breakdown?customer_name=FairPrice")

    assert response.status_code == 200
    assert response.json() == {"rows": []}


def test_bigquery_down_is_503(monkeypatch):
    def unavailable(**_):
        raise GoogleAPICallError("down")

    monkeypatch.setattr(service, "get_tier0_breakdown", unavailable)

    assert TestClient(app).get("/api/scenario/tier0-breakdown").status_code == 503


def test_bad_input_is_400(monkeypatch):
    def bad(**_):
        raise ValueError("Unknown SKU range")

    monkeypatch.setattr(service, "get_tier0_breakdown", bad)

    response = TestClient(app).get("/api/scenario/tier0-breakdown?sku_range=Nope")

    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown SKU range"
