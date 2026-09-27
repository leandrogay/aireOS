import datetime

import pandas as pd
import pytest

from app.services import bigquery


class FakeQueryJob:
    def __init__(self, df):
        self._df = df

    def result(self):
        return self

    def to_dataframe(self):
        return self._df


class FakeBigQueryClient:
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


def _install_fake_client(monkeypatch, df):
    fake_client = FakeBigQueryClient(df)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake_client)
    return fake_client


# ---- forecast rows (model output only) ----


def test_get_forecast_rows_rejects_bad_dates(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame())
    with pytest.raises(ValueError, match="start_date"):
        bigquery.get_forecast_rows(start_date="01-01-2026")


def test_get_forecast_rows_filters_and_serializes(monkeypatch):
    df = pd.DataFrame(
        [
            {
                "month_year": datetime.date(2026, 8, 1),
                "forecast_generated_at": datetime.date(2026, 7, 31),
                "run_type": "yearly",
                "tier": 1,
                "customer_id": 1,
                "customer_name": "fairprice",
                "product_name": "Aire Ultra Tape L",
                "predicted_quantity_units": 680.0,
                "predicted_revenue": 9520.0,
            },
            {
                "month_year": datetime.date(2026, 9, 1),
                "forecast_generated_at": datetime.date(2026, 8, 31),
                "customer_id": 1,
                "customer_name": "fairprice",
                "product_name": "Aire Ultra Tape L",
                "predicted_quantity_units": 700.0,
                "predicted_revenue": 9800.0,
            },
        ]
    )
    fake = _install_fake_client(monkeypatch, df)

    rows = bigquery.get_forecast_rows(
        product_name="Aire Ultra Tape L",
        customer_name="fairprice",
        start_date="2026-07-01",
        end_date="2027-08-01",
    )

    assert bigquery.BQ_FORECAST_TABLE in fake.last_query
    assert "promo_type" not in fake.last_query
    assert "quantity_cartons" not in fake.last_query
    params = _params_by_name(fake.last_job_config)
    assert params["product_name"].value == "Aire Ultra Tape L"
    assert params["customer_name"].value == "fairprice"
    assert str(params["start_date"].value) == "2026-07-01"
    assert str(params["end_date"].value) == "2027-08-01"

    assert rows[0]["run_type"] == "yearly"
    assert rows[0]["tier"] == 1
    assert rows[0]["predicted_quantity_units"] == 680.0
    assert rows[1]["forecast_generated_at"] == "2026-08-31"
    assert rows[1]["run_type"] == "rolling"
    assert rows[1]["tier"] == 0
    assert rows[1]["predicted_revenue"] == 9800.0
    assert "promo_type" not in rows[0]
    assert "quantity_units" not in rows[0]


def test_invalid_tier_raises_without_querying(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery should not be queried for a bad tier")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)
    with pytest.raises(ValueError, match="tier"):
        bigquery.get_forecast_rows(tier=2)


def test_get_forecast_rows_filters_by_tier(monkeypatch):
    fake = _install_fake_client(monkeypatch, pd.DataFrame())

    bigquery.get_forecast_rows(customer_name="fairprice", tier=1)

    assert "COALESCE(tier, 0) = @tier" in fake.last_query
    params = _params_by_name(fake.last_job_config)
    assert params["tier"].value == 1
    assert params["customer_name"].value == "fairprice"


# ---- actuals from v_customer_monthly_sales ----


def test_get_forecast_actuals_rejects_bad_dates(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame())
    with pytest.raises(ValueError, match="end_date"):
        bigquery.get_forecast_actuals(end_date="31-08-2026")


def test_get_forecast_actuals_filters_and_serializes(monkeypatch):
    df = pd.DataFrame(
        [
            {
                "month_year": datetime.date(2026, 8, 1),
                "customer_id": "1",
                "customer_name": "fairprice",
                "product_name": "Aire Adult Pants S/M",
                "quantity_cartons": 209.0,
                "revenue": 2173.31,
            }
        ]
    )
    fake = _install_fake_client(monkeypatch, df)

    rows = bigquery.get_forecast_actuals(
        product_name="Aire Adult Pants S/M",
        customer_name="fairprice",
        start_date="2026-01-01",
        end_date="2026-12-01",
    )

    assert bigquery.BQ_MONTHLY_SALES_VIEW in fake.last_query
    assert "quantity_cartons" in fake.last_query
    assert "period_start" in fake.last_query
    params = _params_by_name(fake.last_job_config)
    assert params["product_name"].value == "Aire Adult Pants S/M"
    assert params["customer_name"].value == "fairprice"
    assert str(params["start_date"].value) == "2026-01-01"
    assert str(params["end_date"].value) == "2026-12-01"

    assert rows == [
        {
            "month_year": "2026-08-01",
            "customer_id": 1,
            "customer_name": "fairprice",
            "product_name": "Aire Adult Pants S/M",
            "quantity_cartons": 209.0,
            "revenue": 2173.31,
        }
    ]


def test_get_forecast_options(monkeypatch):
    df = pd.DataFrame(
        [
            {
                "product_name": "Aire Ultra Tape L",
                "customer_name": "fairprice",
                "month_year": datetime.date(2024, 7, 1),
            },
            {
                "product_name": "Aire Adult Pants L",
                "customer_name": "fairprice",
                "month_year": datetime.date(2027, 8, 1),
            },
        ]
    )
    fake = _install_fake_client(monkeypatch, df)

    options = bigquery.get_forecast_options()

    assert bigquery.BQ_FORECAST_TABLE in fake.last_query
    assert bigquery.BQ_MONTHLY_SALES_VIEW in fake.last_query
    assert "UNION ALL" in fake.last_query
    assert options["customers"] == ["fairprice"]
    assert options["products"] == ["Aire Adult Pants L", "Aire Ultra Tape L"]
    assert options["start_date"] == "2024-07-01"
    assert options["end_date"] == "2027-08-01"


# ---- forecast freshness (per-tier generated_at + sales loaded_at) ----


class FakeFreshnessClient:
    def __init__(self, forecast_df, sales_df):
        self.forecast_df = forecast_df
        self.sales_df = sales_df
        self.queries = []
        self.job_configs = []

    def query(self, query, job_config=None):
        self.queries.append(query)
        self.job_configs.append(job_config)
        if "latest_sales_loaded_at" in query:
            return FakeQueryJob(self.sales_df)
        return FakeQueryJob(self.forecast_df)


def test_get_forecast_freshness_per_tier_and_customer(monkeypatch):
    forecast_df = pd.DataFrame(
        [
            {"tier": 0, "forecast_generated_at": datetime.date(2026, 7, 31)},
            {"tier": 1, "forecast_generated_at": datetime.datetime(2026, 8, 31, 14, 32, 1)},
        ]
    )
    sales_df = pd.DataFrame(
        [{"latest_sales_loaded_at": datetime.datetime(2026, 9, 27, 6, 32, 1)}]
    )
    fake = FakeFreshnessClient(forecast_df, sales_df)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake)

    freshness = bigquery.get_forecast_freshness(customer_name="fairprice")

    assert bigquery.BQ_FORECAST_TABLE in fake.queries[0]
    assert "MAX(forecast_generated_at)" in fake.queries[0]
    assert "GROUP BY tier" in fake.queries[0]
    assert bigquery.BQ_MONTHLY_SALES_VIEW in fake.queries[1]
    assert "MAX(latest_sales_loaded_at)" in fake.queries[1]
    params = _params_by_name(fake.job_configs[0])
    assert params["customer_name"].value == "fairprice"
    assert freshness["forecast_by_tier"]["0"] == "2026-07-31"
    assert freshness["forecast_by_tier"]["1"] == "2026-08-31T14:32:01Z"
    assert freshness["latest_sales_loaded_at"] == "2026-09-27T06:32:01Z"


def test_get_forecast_freshness_all_customers_omits_customer_param(monkeypatch):
    fake = FakeFreshnessClient(
        pd.DataFrame([{"tier": 1, "forecast_generated_at": datetime.date(2026, 8, 31)}]),
        pd.DataFrame([{"latest_sales_loaded_at": None}]),
    )
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake)

    freshness = bigquery.get_forecast_freshness(customer_name=None)

    params = _params_by_name(fake.job_configs[0])
    assert "customer_name" not in params
    assert freshness["forecast_by_tier"]["0"] is None
    assert freshness["forecast_by_tier"]["1"] == "2026-08-31"
    assert freshness["latest_sales_loaded_at"] is None


def test_iso_stamp_keeps_date_or_clock_time():
    assert bigquery._iso_stamp(datetime.date(2026, 8, 31)) == "2026-08-31"
    assert bigquery._iso_stamp(datetime.datetime(2026, 8, 31, 14, 32, 1)) == "2026-08-31T14:32:01Z"
    assert bigquery._iso_stamp(None) is None
