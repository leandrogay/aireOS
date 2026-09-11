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
    """Records the query/job_config it was called with instead of hitting BigQuery."""

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


def _no_client_allowed(monkeypatch):
    def _boom():
        raise AssertionError("get_bigquery_client should not be called")

    monkeypatch.setattr(bigquery, "get_bigquery_client", _boom)


# ---- Validation happens before any BigQuery call ----------------------------

def test_invalid_metric_raises_without_querying(monkeypatch):
    _no_client_allowed(monkeypatch)
    with pytest.raises(ValueError):
        bigquery.get_sku_ranking(metric="profit")


def test_invalid_order_raises_without_querying(monkeypatch):
    _no_client_allowed(monkeypatch)
    with pytest.raises(ValueError):
        bigquery.get_sku_ranking(order="highest")


def test_invalid_mode_raises_without_querying(monkeypatch):
    _no_client_allowed(monkeypatch)
    with pytest.raises(ValueError):
        bigquery.get_sku_ranking(mode="retail")


def test_invalid_start_date_format_raises_without_querying(monkeypatch):
    _no_client_allowed(monkeypatch)
    with pytest.raises(ValueError):
        bigquery.get_sku_ranking(start_date="01-01-2026")


def test_invalid_end_date_format_raises_without_querying(monkeypatch):
    _no_client_allowed(monkeypatch)
    with pytest.raises(ValueError):
        bigquery.get_sku_ranking(end_date="2026/01/01")


# ---- Query construction: metric/order ----------------------------------------

def test_default_sort_is_value_descending(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking()

    assert "ORDER BY value DESC" in fake_client.last_query


def test_metric_volume_ascending_builds_matching_order_by(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking(metric="volume", order="asc")

    assert "ORDER BY volume ASC" in fake_client.last_query


def test_order_by_has_no_secondary_sort_key(monkeypatch):
    # Documents the current lack of a tie-breaker: SKUs with equal totals
    # have BigQuery/engine-determined relative order, since ORDER BY only
    # ever names the one metric column.
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking(metric="value", order="desc")

    order_by_clause = fake_client.last_query.split("ORDER BY")[1].strip().splitlines()[0]
    assert "," not in order_by_clause


def test_query_has_no_limit_clause(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking()

    assert "LIMIT" not in fake_client.last_query.upper()


# ---- Query construction: filters ---------------------------------------------

def test_sku_filter_adds_equality_parameter(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking(sku="ABC123")

    assert "sku = @sku" in fake_client.last_query
    params = _params_by_name(fake_client.last_job_config)
    assert params["sku"].value == "ABC123"


def test_mode_filter_scopes_to_single_retailer(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking(mode="offline", customer="fairprice")

    assert "retailer = @retailer" in fake_client.last_query
    assert "UNNEST" not in fake_client.last_query
    params = _params_by_name(fake_client.last_job_config)
    assert params["retailer"].value == "fairprice_offline"


def test_no_mode_scopes_to_both_channels(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking(mode=None, customer="fairprice")

    assert "retailer IN UNNEST(@retailers)" in fake_client.last_query
    params = _params_by_name(fake_client.last_job_config)
    assert set(params["retailers"].values) == {"fairprice_offline", "fairprice_online"}


def test_store_filter_adds_equality_parameter(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking(store="S001")

    assert "store_code = @store" in fake_client.last_query
    params = _params_by_name(fake_client.last_job_config)
    assert params["store"].value == "S001"


def test_date_range_filters_are_inclusive_on_both_ends(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking(start_date="2026-08-01", end_date="2026-08-31")

    assert "period_start >= @start_date" in fake_client.last_query
    assert "period_start <= @end_date" in fake_client.last_query
    params = _params_by_name(fake_client.last_job_config)
    assert params["start_date"].value == datetime.date(2026, 8, 1)
    assert params["end_date"].value == datetime.date(2026, 8, 31)


def test_no_filters_omits_optional_parameters(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    fake_client = _install_fake_client(monkeypatch, df)

    bigquery.get_sku_ranking()

    params = _params_by_name(fake_client.last_job_config)
    assert "sku" not in params
    assert "store" not in params
    assert "start_date" not in params
    assert "end_date" not in params


# ---- Result shaping ------------------------------------------------------------

def test_rank_follows_returned_row_order(monkeypatch):
    # rank is assigned 1..N purely from the DataFrame's row order (whatever
    # BigQuery returned), not recomputed independently from the values.
    df = pd.DataFrame(
        {
            "sku": ["C", "A", "B"],
            "product_name": ["Gadget C", "Gadget A", "Gadget B"],
            "volume": [5, 50, 20],
            "value": [50.0, 500.0, 200.0],
        }
    )
    _install_fake_client(monkeypatch, df)

    ranked = bigquery.get_sku_ranking()

    assert list(ranked["sku"]) == ["C", "A", "B"]
    assert list(ranked["rank"]) == [1, 2, 3]


def test_value_is_rounded_to_two_decimals(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [123.456]})
    _install_fake_client(monkeypatch, df)

    ranked = bigquery.get_sku_ranking()

    assert ranked.iloc[0]["value"] == 123.46


def test_empty_result_returns_empty_frame_with_expected_columns(monkeypatch):
    df = pd.DataFrame(columns=["sku", "product_name", "volume", "value"])
    _install_fake_client(monkeypatch, df)

    ranked = bigquery.get_sku_ranking(sku="does-not-exist")

    assert ranked.empty
    assert list(ranked.columns) == bigquery.SKU_RANKING_COLUMNS


def test_result_columns_match_expected_shape(monkeypatch):
    df = pd.DataFrame({"sku": ["A"], "product_name": ["Widget"], "volume": [10], "value": [100.0]})
    _install_fake_client(monkeypatch, df)

    ranked = bigquery.get_sku_ranking()

    assert list(ranked.columns) == bigquery.SKU_RANKING_COLUMNS
