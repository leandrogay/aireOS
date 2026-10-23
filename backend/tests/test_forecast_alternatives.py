import datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from google.auth.exceptions import DefaultCredentialsError

from app.main import app
from app.services import bigquery, forecast_service

client = TestClient(app)


class FakeQueryJob:
    def __init__(self, df):
        self._df = df

    def result(self):
        return self

    def to_dataframe(self):
        return self._df


class FakeBigQueryClient:
    """Records the query it was sent and answers with a canned frame."""

    def __init__(self, df):
        self.df = df
        self.last_query = None
        self.last_job_config = None

    def query(self, query, job_config=None):
        self.last_query = query
        self.last_job_config = job_config
        return FakeQueryJob(self.df)


def _params_by_name(job_config):
    return {p.name: p for p in job_config.query_parameters}


def _alternative_record(**overrides):
    record = {
        "customer_id": 1,
        "customer_name": "fairprice",
        "sku": "SKU-L",
        "product_name": "Aire Pants L",
        "month_year": datetime.date(2026, 12, 1),
        "alt_source_model": "tier1_arima",
        "alt_generated_at": pd.Timestamp("2026-10-21T01:45:00Z"),
        "alt_forecast_current": 2540.0,
        "alt_low_80": 2300.0,
        "alt_high_80": 2780.0,
        "alt_backtest_smape": 12.5,
    }
    return {**record, **overrides}


def _no_client_allowed():
    raise AssertionError("BigQuery must not be queried")


# ---- bigquery.get_forecast_alternatives ------------------------------------------


def test_alternatives_query_binds_the_pipeline_thresholds_and_filters(monkeypatch):
    fake = FakeBigQueryClient(pd.DataFrame([_alternative_record()]))
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake)

    rows = bigquery.get_forecast_alternatives(
        product_name="Aire Pants L",
        customer_name="fairprice",
        start_date="2026-01-01",
        end_date="2026-12-31",
    )

    params = _params_by_name(fake.last_job_config)
    assert params["min_history_months"].value == bigquery.TIER0_MIN_HISTORY_MONTHS == 6
    assert params["fallback_smape"].value == bigquery.TIER0_FALLBACK_SMAPE == 50
    assert params["product_name"].value == "Aire Pants L"
    assert params["customer_name"].value == "fairprice"
    assert params["start_date"].value == datetime.date(2026, 1, 1)
    assert rows[0]["alt_forecast_current"] == 2540.0
    assert rows[0]["month_year"] == "2026-12-01"
    assert rows[0]["alt_generated_at"] == "2026-10-21T01:45:00Z"


def test_alternatives_query_only_replaces_xreg_months_of_the_latest_run(monkeypatch):
    fake = FakeBigQueryClient(pd.DataFrame())
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake)

    bigquery.get_forecast_alternatives()

    sql = " ".join(fake.last_query.split())
    assert "MAX(forecast_generated_at)" in sql
    assert "WHERE is_best AND source_model = 'tier1_arimax'" in sql
    # The alternatives are the non-best rows the pipeline already writes.
    assert "a.source_model = 'tier1_arima' AND NOT a.is_best" in sql
    assert "t.source_model = 'tier0_legacy' AND NOT t.is_best" in sql
    assert "aire_forecasting_runs" in sql and "fc_model_quality_views" in sql


def test_no_xreg_months_means_no_alternatives(monkeypatch):
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: FakeBigQueryClient(pd.DataFrame()))

    assert bigquery.get_forecast_alternatives() == []


def test_a_bad_date_is_rejected_before_querying(monkeypatch):
    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)

    with pytest.raises(ValueError):
        bigquery.get_forecast_alternatives(start_date="21/10/2026")


# ---- forecast_service.get_forecast_alternatives ----------------------------------


def test_alternatives_are_priced_at_the_current_lines_realised_price(monkeypatch):
    rows = [
        {"customer_id": 1, "sku": "SKU-L", "alt_forecast_current": 100.0, "alt_low_80": 80.0, "alt_high_80": None},
        {"customer_id": 1, "sku": "SKU-NOPRICE", "alt_forecast_current": 50.0, "alt_low_80": 40.0, "alt_high_80": 60.0},
    ]
    monkeypatch.setattr(forecast_service.bigquery_service, "get_forecast_alternatives", lambda **kwargs: rows)
    monkeypatch.setattr(
        forecast_service.bigquery_service,
        "get_realised_prices",
        lambda **kwargs: {(1, "SKU-L"): 12.5},
    )

    result = forecast_service.get_forecast_alternatives(customer_name="fairprice", product_name="")

    assert result["customer_name"] == "fairprice"
    assert result["product_name"] is None
    priced, unpriced = result["rows"]
    assert (priced["alt_forecast_current_revenue"], priced["alt_low_80_revenue"]) == (1250.0, 1000.0)
    assert priced["alt_high_80_revenue"] is None
    assert unpriced["alt_forecast_current_revenue"] is None


# ---- GET /api/forecast/alternatives ----------------------------------------------


def test_alternatives_route_passes_the_filters(monkeypatch):
    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return {**kwargs, "rows": []}

    monkeypatch.setattr(forecast_service, "get_forecast_alternatives", fake)

    response = client.get("/api/forecast/alternatives", params={"customer_name": "fairprice", "start_date": "2026-01-01"})

    assert response.status_code == 200
    assert seen["customer_name"] == "fairprice"
    assert seen["start_date"] == "2026-01-01"


@pytest.mark.parametrize(
    "exc, status",
    [
        (ValueError("start_date must be in YYYY-MM-DD format"), 400),
        (DefaultCredentialsError("no key"), 503),
    ],
)
def test_alternatives_route_maps_errors(monkeypatch, exc, status):
    def boom(**kwargs):
        raise exc

    monkeypatch.setattr(forecast_service, "get_forecast_alternatives", boom)

    assert client.get("/api/forecast/alternatives").status_code == status
