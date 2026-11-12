import datetime

import pandas as pd
import pytest

from app.services import bigquery


class FakeQueryJob:
    def __init__(self, df):
        self._df = df

    def result(self, timeout=None):
        return self

    def to_dataframe(self, create_bqstorage_client=True):
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
        "tier": "tier0",
        "tier_label": "Tier 0 · Baseline",
        "tier_order": 0,
        "source_model": "tier0_legacy",
        "is_available": True,
        "unavailable_reason": None,
        "months_of_history": 26,
        "forecast_initial": None,
        "initial_source_model": None,
        "initial_generated_at": pd.NaT,
        "initial_low_80": None,
        "initial_high_80": None,
        "forecast_previous": None,
        "previous_source_model": None,
        "previous_generated_at": pd.NaT,
        "previous_low_80": None,
        "previous_high_80": None,
        "forecast_current": 540.0,
        "current_source_model": "tier0_legacy",
        "current_generated_at": pd.Timestamp("2026-09-30 16:28:11", tz="UTC"),
        "current_low_80": 410.0,
        "current_high_80": 690.0,
        "current_backtest_smape": 75.6,
        "current_confidence_band": "low",
        "month_range_pct": 26.0,
        "month_confidence_band": "medium",
        "xreg_used_typical_promo": None,
        "promo_mix": "monthly_only",
        "actual_status": "not_yet",
        "output_built_at": pd.Timestamp("2026-11-08 03:00:00", tz="UTC"),
    }
    record.update(overrides)
    return record


def test_forecast_output_rows_reject_bad_dates_without_querying(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery should not be queried for a bad date")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)
    with pytest.raises(ValueError, match="start_date"):
        bigquery.get_forecast_output_rows(start_date="01-01-2026")


def _fixed_scope(monkeypatch, customer_ids=None, skus=None):
    monkeypatch.setattr(
        bigquery,
        "resolve_forecast_scope",
        lambda product_name=None, customer_name=None: {"customer_ids": customer_ids, "skus": skus},
    )


def test_forecast_output_rows_filter_the_table_on_ids_not_names(monkeypatch):
    # The table is clustered on customer_id, sku, tier: only fixed ids in the
    # WHERE let BigQuery skip the rest, so names are resolved to ids first.
    fake = _install_fake_client(monkeypatch, pd.DataFrame())
    _fixed_scope(monkeypatch, customer_ids=[1], skus=["13271338"])

    bigquery.get_forecast_output_rows(
        product_name="Aire Ultra Tape L",
        customer_name="fairprice",
        start_date="2026-08-01",
        end_date="2027-07-01",
    )

    assert bigquery.BQ_FORECAST_OUTPUT_VIEW in fake.last_query
    assert "public_customers" in fake.last_query
    assert "public_skus" in fake.last_query
    assert "output.customer_id IN UNNEST(@customer_ids)" in fake.last_query
    assert "output.sku IN UNNEST(@skus)" in fake.last_query
    params = _params_by_name(fake.last_job_config)
    assert params["customer_ids"].values == [1]
    assert params["skus"].values == ["13271338"]
    assert "product_name" not in params and "customer_name" not in params
    assert str(params["start_date"].value) == "2026-08-01"
    assert str(params["end_date"].value) == "2027-07-01"


def test_forecast_scope_binds_the_names_and_reads_ids(monkeypatch):
    fake = _install_fake_client(
        monkeypatch, pd.DataFrame([{"customer_ids": [3], "skus": ["S2", "S1"]}])
    )

    scope = bigquery.resolve_forecast_scope(product_name="Aire Ultra Tape L", customer_name="nhg")

    assert scope == {"customer_ids": [3], "skus": ["S1", "S2"]}
    params = _params_by_name(fake.last_job_config)
    assert params["customer_name"].value == "nhg"
    assert params["product_name"].value == "Aire Ultra Tape L"
    assert "Aire Ultra Tape L" not in fake.last_query


def test_no_names_means_every_customer_and_sku_without_a_lookup(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery must not be queried")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)

    assert bigquery.resolve_forecast_scope() == {"customer_ids": None, "skus": None}


def test_a_name_that_matches_nothing_skips_the_rows_query(monkeypatch):
    fake = _install_fake_client(monkeypatch, pd.DataFrame([{"customer_ids": []}]))
    queries = []
    record = fake.query
    fake.query = lambda query, job_config=None: queries.append(query) or record(query, job_config)

    assert bigquery.get_forecast_output_rows(customer_name="nobody") == []
    assert len(queries) == 1  # the name lookup only


def test_forecast_output_names_come_from_the_cdc_dataset(monkeypatch):
    # The output view sits in the forecast dataset, but the catalog copies are
    # Datastream's, in the CDC dataset; joining the forecast dataset's
    # public_customers would fail once the page reads the Singapore dataset.
    fake = _install_fake_client(monkeypatch, pd.DataFrame())
    monkeypatch.setattr(bigquery, "BQ_FORECAST_OUTPUT_VIEW", "proj.forecast_ds.aire_forecasting_output")
    monkeypatch.setattr(bigquery.config, "BQ_CDC_DATASET", "proj.cdc_ds")

    bigquery.get_forecast_output_rows()

    assert "`proj.cdc_ds.public_customers`" in fake.last_query
    assert "`proj.cdc_ds.public_skus`" in fake.last_query
    assert "forecast_ds.public_" not in fake.last_query


def test_forecast_output_rows_select_named_columns_only(monkeypatch):
    fake = _install_fake_client(monkeypatch, pd.DataFrame())

    bigquery.get_forecast_output_rows()

    outer_select = fake.last_query.split(f"FROM `{bigquery.BQ_FORECAST_OUTPUT_VIEW}`")[0].split("SELECT")[-1]
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
            "tier": "tier0",
            "tier_label": "Tier 0 · Baseline",
            "tier_order": 0,
            "source_model": "tier0_legacy",
            "is_available": True,
            "unavailable_reason": None,
            "months_of_history": 26,
            "forecast_initial": None,
            "initial_source_model": None,
            "initial_generated_at": None,
            "initial_low_80": None,
            "initial_high_80": None,
            "forecast_previous": None,
            "previous_source_model": None,
            "previous_generated_at": None,
            "previous_low_80": None,
            "previous_high_80": None,
            "previous_range_pct": None,
            "previous_confidence_band": None,
            "forecast_current": 540.0,
            "current_source_model": "tier0_legacy",
            "current_generated_at": "2026-09-30T16:28:11Z",
            "current_low_80": 410.0,
            "current_high_80": 690.0,
            "current_backtest_smape": 75.6,
            "current_confidence_band": "low",
            "month_range_pct": 26.0,
            "month_confidence_band": "medium",
            # NULL outside the Advanced tier reads as "didn't swap the promotion".
            "xreg_used_typical_promo": False,
            "promo_mix": "monthly_only",
            "actual_status": "not_yet",
            "output_built_at": "2026-11-08T03:00:00Z",
        }
    ]


def test_forecast_output_rows_return_every_tier_without_a_tier_filter(monkeypatch):
    # The page switches models without a new request, so it reads all three.
    fake = _install_fake_client(monkeypatch, pd.DataFrame())
    _fixed_scope(monkeypatch, customer_ids=[1])

    bigquery.get_forecast_output_rows(customer_name="fairprice")

    assert "tier = @tier" not in fake.last_query
    assert "tier" not in _params_by_name(fake.last_job_config)
    assert "output.tier_order, output.month_year" in fake.last_query


def test_forecast_output_rows_bind_one_tier_as_a_parameter(monkeypatch):
    fake = _install_fake_client(monkeypatch, pd.DataFrame())

    bigquery.get_forecast_output_rows(tier="tier1_basic")

    assert "tier = @tier" in fake.last_query
    assert _params_by_name(fake.last_job_config)["tier"].value == "tier1_basic"


def test_unknown_tier_raises_without_querying(monkeypatch):
    def _no_client_allowed():
        raise AssertionError("BigQuery should not be queried for an unknown tier")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _no_client_allowed)
    with pytest.raises(ValueError, match="tier must be one of"):
        bigquery.get_forecast_output_rows(tier="best")


def test_previous_range_comes_from_its_own_run_row(monkeypatch):
    # The view has no Previous bounds; they come from the run the view took
    # forecast_previous from, matched on series, month, model and run time.
    fake = _install_fake_client(monkeypatch, pd.DataFrame())

    bigquery.get_forecast_output_rows()

    assert "aire_forecasting_runs` AS previous_run" in fake.last_query
    assert "previous_run.forecast_generated_at = output.previous_generated_at" in fake.last_query
    assert "previous_run.source_model = output.source_model" in fake.last_query
    assert "NOT previous_run.is_best" in fake.last_query
    assert "IF(output.forecast_previous IS NULL, NULL, previous_run.prediction_interval_lower_bound)" in fake.last_query


def test_previous_month_gets_a_range_and_band_like_current(monkeypatch):
    record = _output_record(
        forecast_previous=400.0,
        previous_generated_at=pd.Timestamp("2026-08-31 16:00:00", tz="UTC"),
        previous_low_80=300.0,
        previous_high_80=580.0,
    )
    _install_fake_client(monkeypatch, pd.DataFrame([record]))

    [row] = bigquery.get_forecast_output_rows()

    assert row["previous_low_80"] == 300.0
    assert row["previous_high_80"] == 580.0
    assert row["previous_range_pct"] == 35.0
    assert row["previous_confidence_band"] == "medium"


@pytest.mark.parametrize(
    ("value", "low", "high", "expected"),
    [
        (100.0, 90.0, 110.0, (10.0, "high")),
        (100.0, 80.0, 120.0, (20.0, "high")),
        (100.0, 50.0, 150.0, (50.0, "medium")),
        (100.0, 20.0, 180.0, (80.0, "low")),
        (100.0, None, 120.0, (None, "unknown")),
        (None, 80.0, 120.0, (None, None)),
    ],
)
def test_month_range_uses_the_view_cut_offs(value, low, high, expected):
    assert bigquery.month_range(value, low, high) == expected


def test_current_horizon_reads_the_whole_line_without_a_date_filter(monkeypatch):
    fake = _install_fake_client(
        monkeypatch,
        pd.DataFrame([{"tier": "tier0", "customer_id": 1, "sku": "13271338", "cartons": 5017.0, "months": 12}]),
    )
    _fixed_scope(monkeypatch, customer_ids=[1], skus=["13271338"])

    rows = bigquery.get_current_horizon(product_name="Aire Adult Pants XL", customer_name="fairprice")

    assert rows == [{"tier": "tier0", "customer_id": 1, "sku": "13271338", "cartons": 5017.0, "months": 12}]
    assert "month_year" not in fake.last_query
    assert "GROUP BY tier, customer_id, sku" in fake.last_query
    params = _params_by_name(fake.last_job_config)
    assert params["customer_ids"].values == [1]
    assert params["skus"].values == ["13271338"]


def test_unavailable_tier_row_keeps_its_reason_and_blank_forecast(monkeypatch):
    record = _output_record(
        tier="tier1_advanced",
        tier_order=2,
        is_available=False,
        unavailable_reason="no_familiar_promotions",
        forecast_current=None,
        current_low_80=None,
        current_high_80=None,
        xreg_used_typical_promo=True,
    )
    _install_fake_client(monkeypatch, pd.DataFrame([record]))

    [row] = bigquery.get_forecast_output_rows()

    assert row["is_available"] is False
    assert row["unavailable_reason"] == "no_familiar_promotions"
    assert row["forecast_current"] is None
    assert row["xreg_used_typical_promo"] is True


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
                "sku": "13255044",
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
            "sku": "13255044",
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
