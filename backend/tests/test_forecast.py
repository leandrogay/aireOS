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


def test_get_forecast_rows_rejects_bad_dates(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame())
    with pytest.raises(ValueError, match="start_date"):
        bigquery.get_forecast_rows(start_date="01-01-2026")


def test_get_forecast_rows_filters_and_serializes(monkeypatch):
    df = pd.DataFrame(
        [
            {
                "month_year": datetime.date(2026, 7, 1),
                "forecast_generated_at": pd.NaT,
                "customer_id": 1,
                "customer_name": "fairprice",
                "product_name": "Aire Ultra Tape L",
                "promo_type": "bundle",
                "promotion_mechanic": "Buy 2 Get 1 Free",
                "period_label": "2026-M07",
                "voucher": "B2G1",
                "quantity_units": 644.0,
                "predicted_quantity_units": pd.NA,
                "revenue": 6167.78,
                "predicted_revenue": pd.NA,
            },
            {
                "month_year": datetime.date(2026, 8, 1),
                "forecast_generated_at": datetime.date(2026, 7, 31),
                "run_type": "yearly",
                "tier": 1,
                "customer_id": 1,
                "customer_name": "fairprice",
                "product_name": "Aire Ultra Tape L",
                "promo_type": pd.NA,
                "promotion_mechanic": pd.NA,
                "period_label": pd.NA,
                "voucher": pd.NA,
                "quantity_units": pd.NA,
                "predicted_quantity_units": 680.0,
                "revenue": pd.NA,
                "predicted_revenue": 9520.0,
            },
            {
                "month_year": datetime.date(2026, 9, 1),
                "forecast_generated_at": datetime.date(2026, 8, 31),
                "customer_id": 1,
                "customer_name": "fairprice",
                "product_name": "Aire Ultra Tape L",
                "promo_type": "regular",
                "promotion_mechanic": "20% Off",
                "period_label": "2026-M09",
                "voucher": "FP20",
                "quantity_units": pd.NA,
                "predicted_quantity_units": 700.0,
                "revenue": pd.NA,
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
    params = _params_by_name(fake.last_job_config)
    assert params["product_name"].value == "Aire Ultra Tape L"
    assert params["customer_name"].value == "fairprice"
    assert str(params["start_date"].value) == "2026-07-01"
    assert str(params["end_date"].value) == "2027-08-01"

    assert rows[0]["forecast_generated_at"] is None
    assert rows[0]["customer_id"] == 1
    assert rows[0]["quantity_units"] == 644.0
    assert rows[0]["predicted_quantity_units"] is None
    assert rows[0]["period_label"] == "2026-M07"
    assert rows[0]["voucher"] == "B2G1"
    # Row 0's fixture has no run_type column at all (pre-migration shape) --
    # defaults to 'rolling' just like pl_forecast.normalise_rows does.
    assert rows[0]["run_type"] == "rolling"
    # Row 0/2's fixtures have no tier column at all -- defaults to 0.
    assert rows[0]["tier"] == 0
    assert rows[2]["tier"] == 0
    assert rows[1]["promo_type"] is None
    assert rows[1]["period_label"] is None
    assert rows[1]["voucher"] is None
    assert rows[1]["run_type"] == "yearly"
    assert rows[1]["tier"] == 1
    assert rows[2]["forecast_generated_at"] == "2026-08-31"
    assert rows[2]["predicted_revenue"] == 9800.0
    assert rows[2]["period_label"] == "2026-M09"


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
    assert options["customers"] == ["fairprice"]
    assert options["products"] == ["Aire Adult Pants L", "Aire Ultra Tape L"]
    assert options["start_date"] == "2024-07-01"
    assert options["end_date"] == "2027-08-01"
