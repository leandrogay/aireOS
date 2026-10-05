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


# ---- forecast rows (aire_forecasting_output) ----


def _output_record(**overrides):
    record = {
        "customer_id": 1,
        "customer_name": "fairprice",
        "sku": "13271338",
        "product_name": "Aire Ultra Tape L",
        "month_year": datetime.date(2026, 8, 1),
        "forecast_initial": None,
        "initial_source_model": None,
        "initial_generated_at": pd.NaT,
        "forecast_previous": None,
        "previous_source_model": None,
        "previous_generated_at": pd.NaT,
        "forecast_current": 540.0,
        "current_source_model": "tier0_legacy",
        "current_generated_at": pd.Timestamp("2026-09-30 16:28:11", tz="UTC"),
        "current_low_80": 410.0,
        "current_high_80": 690.0,
        "current_backtest_smape": 75.6,
        "current_confidence_band": "low",
        "promo_mix": "monthly_only",
    }
    record.update(overrides)
    return record


def test_forecast_output_rows_reject_bad_dates_without_querying(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery should not be queried for a bad date")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)
    with pytest.raises(ValueError, match="start_date"):
        bigquery.get_forecast_output_rows(start_date="01-01-2026")


def test_forecast_output_rows_bind_filters_as_parameters(monkeypatch):
    fake = _install_fake_client(monkeypatch, pd.DataFrame())

    bigquery.get_forecast_output_rows(
        product_name="Aire Ultra Tape L",
        customer_name="fairprice",
        start_date="2026-08-01",
        end_date="2027-07-01",
    )

    assert bigquery.BQ_FORECAST_OUTPUT_VIEW in fake.last_query
    assert "public_customers" in fake.last_query
    assert "public_skus" in fake.last_query
    assert "Aire Ultra Tape L" not in fake.last_query
    params = _params_by_name(fake.last_job_config)
    assert params["product_name"].value == "Aire Ultra Tape L"
    assert params["customer_name"].value == "fairprice"
    assert str(params["start_date"].value) == "2026-08-01"
    assert str(params["end_date"].value) == "2027-07-01"


def test_forecast_output_rows_select_named_columns_only(monkeypatch):
    fake = _install_fake_client(monkeypatch, pd.DataFrame())

    bigquery.get_forecast_output_rows()

    outer_select = fake.last_query.split("FROM output_with_names")[0].split("SELECT")[-1]
    for column in bigquery.FORECAST_OUTPUT_COLUMNS:
        assert column in outer_select
    assert "*" not in outer_select


def test_forecast_output_row_keeps_blank_lines_as_none(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame([_output_record()]))

    rows = bigquery.get_forecast_output_rows()

    assert rows == [
        {
            "customer_id": 1,
            "customer_name": "fairprice",
            "sku": "13271338",
            "product_name": "Aire Ultra Tape L",
            "month_year": "2026-08-01",
            "forecast_initial": None,
            "initial_source_model": None,
            "initial_generated_at": None,
            "forecast_previous": None,
            "previous_source_model": None,
            "previous_generated_at": None,
            "forecast_current": 540.0,
            "current_source_model": "tier0_legacy",
            "current_generated_at": "2026-09-30T16:28:11Z",
            "current_low_80": 410.0,
            "current_high_80": 690.0,
            "current_backtest_smape": 75.6,
            "current_confidence_band": "low",
            "promo_mix": "monthly_only",
        }
    ]


# ---- realised prices from v_customer_monthly_sales ----


def test_realised_prices_average_latest_months_per_sku(monkeypatch):
    df = pd.DataFrame(
        [
            {"customer_id": 1, "sku": "13271338", "realised_price": 8.22},
            {"customer_id": 1, "sku": "13255044", "realised_price": None},
        ]
    )
    fake = _install_fake_client(monkeypatch, df)

    prices = bigquery.get_realised_prices(customer_name="fairprice")

    assert bigquery.BQ_MONTHLY_SALES_VIEW in fake.last_query
    assert "SUM(revenue), SUM(quantity_cartons)" in fake.last_query
    params = _params_by_name(fake.last_job_config)
    assert params["customer_name"].value == "fairprice"
    assert params["price_months"].value == bigquery.REALISED_PRICE_MONTHS
    # A SKU whose price can't be worked out is left out, not priced at 0.
    assert prices == {(1, "13271338"): 8.22}


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
                "first_month": datetime.date(2024, 7, 1),
                "last_month": datetime.date(2026, 3, 1),
            },
            {
                "product_name": "Aire Adult Pants L",
                "customer_name": "fairprice",
                "first_month": datetime.date(2025, 1, 1),
                "last_month": datetime.date(2027, 8, 1),
            },
        ]
    )
    fake = _install_fake_client(monkeypatch, df)

    options = bigquery.get_forecast_options()

    assert bigquery.BQ_FORECAST_OUTPUT_VIEW in fake.last_query
    assert bigquery.BQ_MONTHLY_SALES_VIEW in fake.last_query
    assert "UNION ALL" in fake.last_query
    assert options["customers"] == ["fairprice"]
    assert options["products"] == ["Aire Adult Pants L", "Aire Ultra Tape L"]
    assert options["start_date"] == "2024-07-01"
    assert options["end_date"] == "2027-08-01"


def test_forecast_options_are_grouped_in_bigquery_not_downloaded_row_by_row(monkeypatch):
    fake = _install_fake_client(monkeypatch, pd.DataFrame())

    bigquery.get_forecast_options()

    assert "GROUP BY product_name, customer_name" in fake.last_query
    assert "MIN(month_year)" in fake.last_query
    assert "MAX(month_year)" in fake.last_query


# ---- sales freshness (latest sales loaded_at) ----


class FakeSalesLoadedClient:
    def __init__(self, df):
        self.df = df
        self.queries = []
        self.job_configs = []

    def query(self, query, job_config=None):
        self.queries.append(query)
        self.job_configs.append(job_config)
        return FakeQueryJob(self.df)


def test_sales_loaded_at_reads_monthly_sales_for_the_customer(monkeypatch):
    fake = FakeSalesLoadedClient(
        pd.DataFrame([{"latest_sales_loaded_at": datetime.datetime(2026, 9, 27, 6, 32, 1)}])
    )
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake)

    loaded_at = bigquery.get_sales_loaded_at(customer_name="fairprice")

    assert len(fake.queries) == 1
    assert bigquery.BQ_MONTHLY_SALES_VIEW in fake.queries[0]
    assert bigquery.BQ_FORECAST_OUTPUT_VIEW not in fake.queries[0]
    assert _params_by_name(fake.job_configs[0])["customer_name"].value == "fairprice"
    assert loaded_at == "2026-09-27T06:32:01Z"


def test_sales_loaded_at_all_customers_omits_customer_param(monkeypatch):
    fake = FakeSalesLoadedClient(pd.DataFrame([{"latest_sales_loaded_at": None}]))
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake)

    loaded_at = bigquery.get_sales_loaded_at(customer_name=None)

    assert "customer_name" not in _params_by_name(fake.job_configs[0])
    assert loaded_at is None


def test_iso_stamp_keeps_date_or_clock_time():
    assert bigquery._iso_stamp(datetime.date(2026, 8, 31)) == "2026-08-31"
    assert bigquery._iso_stamp(datetime.datetime(2026, 8, 31, 14, 32, 1)) == "2026-08-31T14:32:01Z"
    assert bigquery._iso_stamp(None) is None


def test_iso_stamp_treats_nat_as_blank():
    # An all-NULL TIMESTAMP column (previous / initial before they exist)
    # comes back from BigQuery as NaT, which used to crash on strftime.
    assert bigquery._iso_stamp(pd.NaT) is None
