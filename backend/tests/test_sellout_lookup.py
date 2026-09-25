import pytest

from app.services import sellout_lookup


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def monotonic(self):
        return self.now


def _catalog(marker):
    return {
        "retailer_ids": {"fairprice_offline": 57},
        "retailer_names": {57: "fairprice_offline"},
        "stores": {},
        "skus": {"A": {"product_name": marker, "sku_range": None, "size": None}},
    }


def _install(monkeypatch, loader):
    clock = FakeClock()
    monkeypatch.setattr(sellout_lookup, "time", clock)
    monkeypatch.setattr(sellout_lookup, "_load", loader)
    sellout_lookup.reset_cache()
    return clock


# ---- caching ------------------------------------------------------------------

def test_lookup_loads_once_within_the_ttl(monkeypatch):
    calls = []
    _install(monkeypatch, lambda: calls.append(1) or _catalog("v1"))

    sellout_lookup.sku_details()
    sellout_lookup.retailer_names()
    sellout_lookup.store_details()

    assert len(calls) == 1


def test_lookup_reloads_after_the_ttl(monkeypatch):
    versions = iter(["v1", "v2"])
    clock = _install(monkeypatch, lambda: _catalog(next(versions)))

    assert sellout_lookup.sku_details()["A"]["product_name"] == "v1"
    clock.now += sellout_lookup.CACHE_TTL_SECONDS + 1

    assert sellout_lookup.sku_details()["A"]["product_name"] == "v2"


# ---- failure handling -------------------------------------------------------------

def test_failed_refresh_keeps_serving_the_last_good_copy(monkeypatch):
    calls = []

    def loader():
        calls.append(1)
        if len(calls) > 1:
            raise RuntimeError("cloud sql unreachable")
        return _catalog("v1")

    clock = _install(monkeypatch, loader)
    sellout_lookup.sku_details()
    clock.now += sellout_lookup.CACHE_TTL_SECONDS + 1

    assert sellout_lookup.sku_details()["A"]["product_name"] == "v1"  # stale, not an error
    assert sellout_lookup.sku_details()["A"]["product_name"] == "v1"
    assert len(calls) == 2  # the second read didn't hammer the failing database again


def test_failed_refresh_is_retried_after_the_short_backoff(monkeypatch):
    calls = []

    def loader():
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("blip")
        return _catalog(f"v{len(calls)}")

    clock = _install(monkeypatch, loader)
    sellout_lookup.sku_details()
    clock.now += sellout_lookup.CACHE_TTL_SECONDS + 1
    sellout_lookup.sku_details()  # fails, backs off
    clock.now += sellout_lookup.RETRY_AFTER_FAILURE_SECONDS + 1

    assert sellout_lookup.sku_details()["A"]["product_name"] == "v3"


def test_cold_start_failure_raises_a_catalog_unavailable_error(monkeypatch):
    # The routers map this to a 503; a bare driver exception would surface as
    # an unhandled 500 with no CORS header.
    def loader():
        raise RuntimeError("cloud sql unreachable")

    _install(monkeypatch, loader)

    with pytest.raises(sellout_lookup.CatalogUnavailableError, match="cloud sql unreachable"):
        sellout_lookup.retailer_ids(["fairprice_offline"])


# ---- retailer_ids -----------------------------------------------------------------

def test_retailer_ids_maps_names_and_skips_unknown_ones(monkeypatch):
    _install(monkeypatch, lambda: _catalog("v1"))

    assert sellout_lookup.retailer_ids(["fairprice_offline", "nhg_offline"]) == [57]
    assert sellout_lookup.retailer_ids(["nhg_offline"]) == []
