import datetime

import pandas as pd
import pytest

from app.services import bigquery, sellout_lookup


@pytest.fixture(autouse=True)
def _fake_catalog(monkeypatch):
    # A small in-memory mirror of the Cloud SQL retailers/stores/skus rows so
    # nothing reaches Cloud SQL (55/57 are the real fairprice online/offline ids).
    sellout_lookup.reset_cache()
    monkeypatch.setattr(
        sellout_lookup,
        "_load",
        lambda: {
            "retailer_ids": {"fairprice_online": 55, "fairprice_offline": 57},
            "retailer_names": {55: "fairprice_online", 57: "fairprice_offline"},
            "stores": {
                (57, "420"): {"store_name": "AMK HYPERMART", "store_format": "HYPER"},
                (57, "367"): {"store_name": "WHITESANDS", "store_format": "SUPER"},
                (55, "4"): {"store_name": "FAIRPRICE ON", "store_format": "FPON"},
            },
            "skus": {
                "A": {"product_name": "Aire Adult Pants S/M", "sku_range": "Aire Adult Diaper Pants", "size": "S/M"},
                "B": {"product_name": "Aire Adult Pants XL", "sku_range": "Aire Adult Diaper Pants", "size": "XL"},
                "C": {"product_name": "Aire Ultra Tape L", "sku_range": "Aire Adult Diaper Ultra Tape", "size": "L"},
            },
        },
    )
    yield
    sellout_lookup.reset_cache()


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


def _install_fake_client(monkeypatch, df):
    fake_client = FakeBigQueryClient(df)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake_client)
    return fake_client


def _params_by_name(job_config):
    return {p.name: p for p in job_config.query_parameters}


D = datetime.date


# ---- table + label helpers -------------------------------------------------------

def test_default_table_is_public_sellout():
    assert bigquery.SELLOUT_TABLE == "aire-data.Aire_Data.public_sellout"


def test_week_label_matches_the_label_the_old_table_stored():
    assert bigquery._week_label(D(2026, 5, 7)) == "Week 19 (07-05-2026)"
    assert bigquery._week_label(D(2026, 1, 1)) == "Week 1 (01-01-2026)"
    assert bigquery._week_label(D(2026, 9, 3)) == "Week 36 (03-09-2026)"


# ---- _dashboard_rows: per-store rows -> per-format-per-period rows -----------------

def _store_week_rows():
    return pd.DataFrame(
        [
            {"retailer_id": 57, "store_code": "420", "period_start": D(2026, 5, 7), "revenue": 100.0, "units": 10.0},
            {"retailer_id": 57, "store_code": "367", "period_start": D(2026, 5, 7), "revenue": 50.0, "units": 5.0},
            {"retailer_id": 57, "store_code": "999", "period_start": D(2026, 5, 7), "revenue": 7.0, "units": 1.0},
            {"retailer_id": 55, "store_code": "4", "period_start": D(2026, 5, 7), "revenue": 30.0, "units": 3.0},
            {"retailer_id": 99, "store_code": "1", "period_start": D(2026, 5, 7), "revenue": 999.0, "units": 99.0},
        ]
    )


def test_dashboard_rows_resolves_retailer_and_format_from_the_catalog():
    rows = bigquery._dashboard_rows(_store_week_rows(), "week")

    by_format = {(r["retailer"], r["format"]): r["revenue"] for _, r in rows.iterrows()}
    assert by_format == {
        ("fairprice_offline", "HYPER"): 100.0,
        ("fairprice_offline", "SUPER"): 50.0,
        ("fairprice_offline", "UNKNOWN"): 7.0,  # store missing from the catalog still counts
        ("fairprice_online", "FPON"): 30.0,
    }


def test_dashboard_rows_drops_retailer_ids_the_catalog_cannot_name():
    rows = bigquery._dashboard_rows(_store_week_rows(), "week")

    assert 999.0 not in set(rows["revenue"])


def test_dashboard_rows_week_label_is_derived_from_period_start():
    rows = bigquery._dashboard_rows(_store_week_rows(), "week")

    assert set(rows["period_label"]) == {"Week 19 (07-05-2026)"}


def test_dashboard_rows_month_granularity_rolls_weeks_into_one_period():
    df = pd.DataFrame(
        [
            {"retailer_id": 57, "store_code": "420", "period_start": D(2026, 5, 7), "revenue": 100.0, "units": 10.0},
            {"retailer_id": 57, "store_code": "420", "period_start": D(2026, 5, 14), "revenue": 60.0, "units": 6.0},
            {"retailer_id": 57, "store_code": "420", "period_start": D(2026, 6, 4), "revenue": 40.0, "units": 4.0},
        ]
    )

    rows = bigquery._dashboard_rows(df, "month")

    by_label = {r["period_label"]: (r["revenue"], r["units"], r["period_start"]) for _, r in rows.iterrows()}
    assert by_label == {
        "May 2026": (160.0, 16.0, D(2026, 5, 7)),
        "June 2026": (40.0, 4.0, D(2026, 6, 4)),
    }


def test_dashboard_rows_sums_stores_that_share_a_format():
    df = pd.DataFrame(
        [
            {"retailer_id": 57, "store_code": "420", "period_start": D(2026, 5, 7), "revenue": 100.0, "units": 10.0},
            {"retailer_id": 57, "store_code": "420", "period_start": D(2026, 5, 7), "revenue": 25.5, "units": 2.0},
        ]
    )

    rows = bigquery._dashboard_rows(df, "week")

    assert len(rows) == 1
    assert rows.iloc[0]["revenue"] == 125.5


# ---- get_dashboard_summary: end to end ----------------------------------------------

def test_dashboard_summary_keeps_the_shape_the_frontend_renders(monkeypatch):
    fake_client = _install_fake_client(monkeypatch, _store_week_rows())

    summary = bigquery.get_dashboard_summary(granularity="week", customer="fairprice")

    assert "retailer_id IN UNNEST(@retailer_ids)" in fake_client.last_query
    assert set(_params_by_name(fake_client.last_job_config)["retailer_ids"].values) == {55, 57}

    offline = summary["offline"]
    assert offline["periodTotal"] == [
        {"period_label": "Week 19 (07-05-2026)", "period_start": D(2026, 5, 7), "revenue": 157.0, "units": 16.0}
    ]
    assert [f["format"] for f in offline["storeFormats"]] == ["HYPER", "SUPER", "UNKNOWN"]  # revenue descending
    assert summary["online"]["periodTotal"][0]["revenue"] == 30.0


def test_dashboard_summary_with_no_rows_returns_empty_views(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame(columns=["retailer_id", "store_code", "period_start", "revenue", "units"]))

    summary = bigquery.get_dashboard_summary()

    assert summary["offline"] == {"storeFormats": [], "periodTotal": [], "periodByFormat": []}


# ---- dropdown options --------------------------------------------------------------

def test_sku_options_use_catalog_names_grouped_by_range_then_size(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame({"sku": ["C", "B", "ZZZ", "A"]}))

    options = bigquery.get_sku_options(customer="fairprice")

    assert options == [
        {"sku": "ZZZ", "product_name": "ZZZ"},  # not in the catalog: shown by code, sorts first
        {"sku": "A", "product_name": "Aire Adult Pants S/M"},
        {"sku": "B", "product_name": "Aire Adult Pants XL"},
        {"sku": "C", "product_name": "Aire Ultra Tape L"},
    ]


def test_sku_options_empty_when_no_rows(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame(columns=["sku"]))

    assert bigquery.get_sku_options() == []


def test_store_options_use_catalog_names_sorted_by_name(monkeypatch):
    df = pd.DataFrame(
        [
            {"retailer_id": 57, "store_code": "420"},
            {"retailer_id": 57, "store_code": "367"},
            {"retailer_id": 55, "store_code": "4"},
            {"retailer_id": 57, "store_code": "999"},  # not in the catalog
        ]
    )
    _install_fake_client(monkeypatch, df)

    options = bigquery.get_store_options(customer="fairprice")

    assert options == [
        {"store_code": "999", "store_name": "999"},
        {"store_code": "420", "store_name": "AMK HYPERMART"},
        {"store_code": "4", "store_name": "FAIRPRICE ON"},
        {"store_code": "367", "store_name": "WHITESANDS"},
    ]


def test_store_options_show_a_code_shared_by_both_channels_once_with_its_real_name(monkeypatch):
    df = pd.DataFrame(
        [
            {"retailer_id": 55, "store_code": "420"},  # this channel's catalog has no name for it
            {"retailer_id": 57, "store_code": "420"},
        ]
    )
    _install_fake_client(monkeypatch, df)

    assert bigquery.get_store_options() == [{"store_code": "420", "store_name": "AMK HYPERMART"}]


def test_customer_options_are_families_of_the_retailers_the_catalog_names(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame({"retailer_id": [55, 57, 99]}))  # 99 unknown

    assert bigquery.get_customer_options() == [{"value": "fairprice", "label": "Fairprice"}]


def test_customer_options_empty_when_no_rows(monkeypatch):
    _install_fake_client(monkeypatch, pd.DataFrame(columns=["retailer_id"]))

    assert bigquery.get_customer_options() == []


# ---- data freshness ------------------------------------------------------------------

def test_data_freshness_is_keyed_by_retailer_name(monkeypatch):
    df = pd.DataFrame(
        {
            "retailer_id": [55, 57, 99],
            "loaded_at": [
                pd.Timestamp("2026-09-11 08:43:00", tz="UTC"),
                pd.Timestamp("2026-09-11 08:43:00", tz="UTC"),
                pd.Timestamp("2026-09-11 08:43:00", tz="UTC"),
            ],
        }
    )
    _install_fake_client(monkeypatch, df)

    freshness = bigquery.get_data_freshness()

    assert set(freshness) == {"fairprice_online", "fairprice_offline"}  # 99 can't be named
    assert freshness["fairprice_offline"] == "11/09/26 16:43:00"  # shown in Singapore time
