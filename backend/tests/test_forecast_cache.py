import threading

import pandas as pd
import pytest

from app.services import bigquery, forecast_cache

# ---- single flight ----------------------------------------------------------


def test_overlapping_identical_reads_share_one_query():
    calls = []
    started = threading.Event()
    release = threading.Event()

    def load():
        calls.append(1)
        started.set()
        release.wait(5)
        return ["rows"]

    results = []
    first = threading.Thread(target=lambda: results.append(forecast_cache.single_flight(("k",), load)))
    first.start()
    started.wait(5)
    second = threading.Thread(target=lambda: results.append(forecast_cache.single_flight(("k",), load)))
    second.start()
    release.set()
    first.join(5)
    second.join(5)

    assert calls == [1]
    assert results == [["rows"], ["rows"]]


def test_reads_with_different_keys_do_not_share():
    calls = []

    forecast_cache.single_flight(("a",), lambda: calls.append("a"))
    forecast_cache.single_flight(("b",), lambda: calls.append("b"))

    assert calls == ["a", "b"]


def test_a_failed_read_reaches_its_caller_and_is_not_kept():
    def boom():
        raise RuntimeError("BigQuery down")

    with pytest.raises(RuntimeError):
        forecast_cache.cached(("k",), boom, lambda: "built-1")

    assert forecast_cache.cached(("k",), lambda: "fresh", lambda: "built-1") == "fresh"


# ---- cache ------------------------------------------------------------------


def test_a_result_is_reused_while_the_table_is_unchanged():
    calls = []

    def load():
        calls.append(1)
        return len(calls)

    assert forecast_cache.cached(("k",), load, lambda: "built-1") == 1
    assert forecast_cache.cached(("k",), load, lambda: "built-1") == 1
    assert calls == [1]


def test_a_rebuilt_output_table_is_read_again():
    calls = []

    def load():
        calls.append(1)
        return len(calls)

    forecast_cache.cached(("k",), load, lambda: "built-1")

    assert forecast_cache.cached(("k",), load, lambda: "built-2") == 2


def test_a_result_older_than_ten_minutes_is_read_again(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(forecast_cache.time, "monotonic", lambda: now[0])
    calls = []

    def load():
        calls.append(1)
        return len(calls)

    forecast_cache.cached(("k",), load, lambda: "built-1")
    now[0] += forecast_cache.CACHE_SECONDS - 1
    assert forecast_cache.cached(("k",), load, lambda: "built-1") == 1
    now[0] += 2
    assert forecast_cache.cached(("k",), load, lambda: "built-1") == 2


def test_the_rebuild_time_is_read_at_most_once_a_minute(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(forecast_cache.time, "monotonic", lambda: now[0])
    reads = []

    def load_stamp():
        reads.append(1)
        return f"built-{len(reads)}"

    assert forecast_cache.stamp(load_stamp) == "built-1"
    now[0] += forecast_cache.STAMP_SECONDS - 1
    assert forecast_cache.stamp(load_stamp) == "built-1"
    now[0] += 2
    assert forecast_cache.stamp(load_stamp) == "built-2"


# ---- forecast rows: the key covers the scope ---------------------------------


class RecordingClient:
    def __init__(self):
        self.queries = []

    def query(self, query, job_config=None):
        self.queries.append({p.name: getattr(p, "values", None) or p.value for p in job_config.query_parameters})
        return self

    def result(self, timeout=None):
        return self

    def to_dataframe(self, create_bqstorage_client=True):
        return pd.DataFrame()


def test_the_cache_key_covers_the_sku_selection(monkeypatch):
    client = RecordingClient()
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: client)
    scopes = {
        "Pants L": {"customer_ids": [1], "skus": ["S1"]},
        "Pants XL": {"customer_ids": [1], "skus": ["S2"]},
    }
    monkeypatch.setattr(
        bigquery,
        "resolve_forecast_scope",
        lambda product_name=None, customer_name=None, sku_range=None: scopes[product_name],
    )

    bigquery.get_forecast_output_rows(product_name="Pants L", customer_name="fairprice")
    bigquery.get_forecast_output_rows(product_name="Pants XL", customer_name="fairprice")
    bigquery.get_forecast_output_rows(product_name="Pants L", customer_name="fairprice")

    assert [query["skus"] for query in client.queries] == [["S1"], ["S2"]]


def test_callers_get_their_own_copy_of_cached_rows(monkeypatch):
    monkeypatch.setattr(
        bigquery, "_read_forecast_output_rows", lambda *_args: [{"sku": "S1", "forecast_current": 10.0}]
    )

    first = bigquery.get_forecast_output_rows()
    first[0]["forecast_current"] = 999.0

    assert bigquery.get_forecast_output_rows()[0]["forecast_current"] == 10.0
