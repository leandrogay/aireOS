"""
Resolves the bare IDs/codes in the BigQuery sell-out table to names.

public_sellout rows carry only retailer_id, store_code and sku -- no names,
no store format. The names live in the Cloud SQL catalog (retailers, stores,
skus), so bigquery.py asks this module to translate after each query.

The catalog is small and rarely changes, so all three lookups are loaded
together and cached for a few minutes. If a refresh fails (Cloud SQL
unreachable) the last good copy keeps being served so a database blip does
not take every dashboard request down with it; only a cold start with no
copy at all raises CatalogUnavailableError, which the routers map to a 503.
"""

import threading
import time

from app.services import catalog_service

CACHE_TTL_SECONDS = 300
RETRY_AFTER_FAILURE_SECONDS = 30

_cache: dict | None = None
_cache_loaded_at = 0.0
_lock = threading.Lock()


class CatalogUnavailableError(Exception):
    """The Cloud SQL catalog can't be reached and there is no earlier copy to serve."""


def _load() -> dict:
    retailers = catalog_service.get_retailers()
    return {
        "retailer_ids": {r["retailer_name"]: r["retailer_id"] for r in retailers},
        "retailer_names": {r["retailer_id"]: r["retailer_name"] for r in retailers},
        "stores": {
            (s["retailer_id"], s["store_code"]): {
                "store_name": s["store_name"],
                "store_format": s["store_format"],
            }
            for s in catalog_service.get_stores()
        },
        "skus": {
            p["sku"]: {
                "product_name": p["product_name"],
                "sku_range": p["sku_range"],
                "size": p["size"],
            }
            for p in catalog_service.get_skus()
        },
    }


def _lookup() -> dict:
    global _cache, _cache_loaded_at
    with _lock:
        if _cache is not None and time.monotonic() - _cache_loaded_at < CACHE_TTL_SECONDS:
            return _cache
        try:
            _cache = _load()
            _cache_loaded_at = time.monotonic()
        except Exception as e:
            if _cache is None:
                raise CatalogUnavailableError(f"{type(e).__name__}: {e}") from e
            # Serve the stale copy, and wait a short while before retrying
            # instead of hitting the failing database on every request.
            _cache_loaded_at = time.monotonic() - CACHE_TTL_SECONDS + RETRY_AFTER_FAILURE_SECONDS
        return _cache


def reset_cache() -> None:
    global _cache, _cache_loaded_at
    with _lock:
        _cache = None
        _cache_loaded_at = 0.0


def retailer_ids(retailer_names: list[str]) -> list[int]:
    # Names the catalog doesn't know are skipped, so an unknown customer
    # matches no rows instead of raising.
    ids = _lookup()["retailer_ids"]
    return [ids[name] for name in retailer_names if name in ids]


def retailer_names() -> dict[int, str]:
    return _lookup()["retailer_names"]


def store_details() -> dict[tuple[int, str], dict]:
    return _lookup()["stores"]


def sku_details() -> dict[str, dict]:
    return _lookup()["skus"]
