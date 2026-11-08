"""
Single-flight and a short cache for forecast reads from BigQuery.

A BigQuery read costs seconds however few rows it returns, and the Forecast
page, Inventory and the Assistant often ask for the same scope at once (a
page load fires several, a refresh fires them again). So:

  - single_flight: identical reads that overlap share one query; the later
    callers wait for the first one's result (or its error) instead of
    starting their own.
  - cached: a read's result is kept for CACHE_SECONDS, or until
    aire_forecasting_output is rebuilt (its output_built_at changes), which
    is the only time the forecast itself changes.

Process-wide, per Cloud Run instance. Keys are tuples of the read's name and
every argument that changes its result (customer, SKUs, tier, months), so
two scopes never share an entry. Pure Python, no BigQuery import, so the
bigquery service can use it without a cycle.
"""

import threading
import time
from collections.abc import Callable, Hashable
from concurrent.futures import Future

CACHE_SECONDS = 10 * 60
# How long one output_built_at answer is trusted before it is read again.
STAMP_SECONDS = 60
# Plenty for the filter combinations people use; the oldest go first past it.
MAX_ENTRIES = 256

_STAMP_KEY = ("output_built_at",)

_lock = threading.Lock()
_in_flight: dict[Hashable, Future] = {}
# key -> (stored at (monotonic seconds), output_built_at when read, value)
_entries: dict[Hashable, tuple[float, object, object]] = {}


def clear() -> None:
    """Forget every cached result (tests; nothing in the app needs it)."""
    with _lock:
        _entries.clear()


def single_flight(key: Hashable, load: Callable[[], object]) -> object:
    """Run `load` once for every overlapping call with the same key.

    Later callers wait for the first caller's read to finish and get its
    rows (or its error), so a slow read is never started twice.
    """
    with _lock:
        future = _in_flight.get(key)
        is_owner = future is None
        if is_owner:
            future = Future()
            _in_flight[key] = future
    if not is_owner:
        return future.result()

    try:
        value = load()
    except BaseException as exc:
        future.set_exception(exc)
        raise
    else:
        future.set_result(value)
        return value
    finally:
        with _lock:
            _in_flight.pop(key, None)


def _fresh(key: Hashable, max_age: float, stamp: object) -> tuple[bool, object]:
    with _lock:
        entry = _entries.get(key)
    if entry is None:
        return False, None
    stored_at, entry_stamp, value = entry
    if time.monotonic() - stored_at >= max_age or entry_stamp != stamp:
        return False, None
    return True, value


def _store(key: Hashable, stamp: object, value: object) -> None:
    with _lock:
        _entries[key] = (time.monotonic(), stamp, value)
        if len(_entries) > MAX_ENTRIES:
            oldest = min(_entries, key=lambda item: _entries[item][0])
            del _entries[oldest]


def stamp(load_stamp: Callable[[], object]) -> object:
    """The current output_built_at, read at most once per STAMP_SECONDS."""
    hit, value = _fresh(_STAMP_KEY, STAMP_SECONDS, None)
    if hit:
        return value
    value = single_flight(_STAMP_KEY, load_stamp)
    _store(_STAMP_KEY, None, value)
    return value


def cached(key: Hashable, load: Callable[[], object], current_stamp: Callable[[], object]) -> object:
    """`load`'s result for `key`, reused while under CACHE_SECONDS old and
    built from the same output_built_at as now (`current_stamp()`).

    The value is shared between callers: callers must not change it (the
    bigquery readers hand out copies of their rows).
    """
    built_at = current_stamp()
    hit, value = _fresh(key, CACHE_SECONDS, built_at)
    if hit:
        return value
    value = single_flight(key, load)
    _store(key, built_at, value)
    return value
