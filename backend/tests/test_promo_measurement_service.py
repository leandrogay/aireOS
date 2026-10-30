from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from conftest import FakeConnection, FakeEngine

from app.services.settings import common
from app.services.settings import promo_measurement as service


CONFIG = dict(service.DEFAULT_CONFIG)
WINDOW = (date(2025, 1, 1), date(2025, 12, 31))


class RecordingDatabase:
    """
    Answers the measurement's writes: every INSERT ... RETURNING gets the
    next id, the advisory lock is free unless told otherwise, and reads the
    tests don't stub come back empty. Any DELETE, or an UPDATE that isn't a
    supersede, fails the test (everything is append-only).
    """

    def __init__(self, lock_free=True, last_fingerprint=None, note=None):
        self.next_id = 100
        self.lock_free = lock_free
        self.last_fingerprint = last_fingerprint
        self.note = note

    def respond(self, sql, params):
        if sql.startswith("DELETE") or (sql.startswith("UPDATE") and "superseded_at = now()" not in sql):
            raise AssertionError(f"append-only: {sql}")
        if "pg_try_advisory_xact_lock" in sql:
            return [(self.lock_free,)]
        if "SELECT input_fingerprint FROM promo_measurement_runs" in sql:
            return [(self.last_fingerprint,)] if self.last_fingerprint else []
        if "FROM promo_uplift_pending_notes WHERE id = :note_id FOR UPDATE" in sql:
            return [self.note] if self.note else []
        if "RETURNING" in sql:
            self.next_id += 1
            return [(self.next_id,)]
        return []


def _install(monkeypatch, db):
    conn = FakeConnection(db.respond)
    engine = FakeEngine(conn)
    monkeypatch.setattr(common, "get_engine", lambda: engine)
    monkeypatch.setattr(common, "get_read_engine", lambda: engine)
    return conn


def _setting(key, scope="all", source="rule_based", uplift="4", customer_id=None, sku=None, row_id=1, discount="30"):
    return {
        "id": row_id,
        "mechanic_key": key,
        "mechanic_label": key,
        "effective_discount_pct": Decimal(discount) if discount is not None else None,
        "scope": scope,
        "customer_id": customer_id,
        "customer_name": "fairprice" if customer_id else None,
        "sku_range": None,
        "sku": sku,
        "uplift_pct": Decimal(uplift),
        "source": source,
        "kind": "promotion",
        "evidence_months": None,
        "note": None,
        "changed_by": "seed",
        "changed_at": None,
        "superseded_at": None,
        "archived_at": None,
    }


def _target(sku=None, blended=6.0, hold=False, key="pct_off_30"):
    return {
        "customer_id": 1, "sku": sku, "mechanic_key": key, "method": "trend" if sku else None,
        "n": 4.0 if sku else None, "big_n": 5.0, "sku_own_pct": 8.0 if sku else None, "customer_own_pct": 7.0,
        "rule_based_pct": 4.0, "starting_weight": 3.0, "blended_pct": blended, "backtest_pct": -5.0 if hold else 3.0,
        "backtest_months": 2.0, "hold": hold, "evidence_months": 4.0 if sku else 5.0,
    }


def _inputs(settings, notes=None):
    return {
        "window_start": WINDOW[0], "window_end": WINDOW[1], "settings": settings,
        "sku_ranges": {"SKU-L": "Pants"}, "notes": notes or {}, "anchor_views": [], "anchor_rows": {},
        "rule_rate": Decimal("0.4"),
    }


def _measured(*targets, to_create=None):
    return {"targets": list(targets), "to_create": to_create or {}, "warnings": [], "reach": {1: 0.67}}


# ---- _measure (no database) -----------------------------------------------------------


def _measure_inputs():
    months = [date(2025, m, 1) for m in range(1, 9)]
    # Flat sales except June, when a 10-day side offer lifted the month 5%.
    units = {month: (105.0 if month.month == 6 else 100.0) for month in months}
    return {
        "training": {1: {"SKU-L": units}},
        "promotions": {1: [
            {"promotion_id": 1, "promo_type": "monthly", "promotion_mechanic": "20% Off", "mechanic_key": "pct_off_20",
             "voucher": 0, "period_start": date(2025, 1, 1), "period_end": date(2025, 8, 31),
             "stores": {"1|S1"}, "skus": {"SKU-L"}},
            {"promotion_id": 2, "promo_type": "side_offer", "promotion_mechanic": "30% Off", "mechanic_key": "pct_off_30",
             "voucher": 0, "period_start": date(2025, 6, 1), "period_end": date(2025, 6, 10),
             "stores": {"1|S1"}, "skus": {"SKU-L"}},
        ]},
        "store_units": {(1, "SKU-L"): {"1|S1": 800.0}},
        "customer_stores": {1: {"1|S1"}},
        "backtest": None,
        "settings": [_setting("pct_off_20", discount="20", uplift="0"), _setting("pct_off_30", row_id=2)],
        "anchors": {1: Decimal("20")},
        "rule_rate": Decimal("0.4"),
        "labels": ["20% Off", "30% Off", "35% Off", "Free tote bag"],
    }


def test_measure_finds_the_side_offer_and_steadies_it_towards_the_rule_based_uplift():
    result = service._measure(_measure_inputs(), CONFIG)

    sku = next(t for t in result["targets"] if t["sku"] == "SKU-L" and t["mechanic_key"] == "pct_off_30")
    customer = next(t for t in result["targets"] if t["sku"] is None and t["mechanic_key"] == "pct_off_30")
    # A third of a month at +5% is +15% as a full month; with only 8 months the
    # lift also raises the trend line and the average month a little, so part
    # of it is absorbed (a stated limitation) and it lands just under.
    assert 10 < sku["sku_own_pct"] < 15
    assert sku["n"] == pytest.approx(1 / 3)
    # rule-based +4 at a 20% anchor; one month of evidence leans on it.
    assert customer["rule_based_pct"] == 4.0
    assert 4.0 < customer["blended_pct"] < sku["sku_own_pct"]


def test_measure_leaves_a_mechanic_running_every_month_without_evidence():
    result = service._measure(_measure_inputs(), CONFIG)

    every_month = next(t for t in result["targets"] if t["sku"] is None and t["mechanic_key"] == "pct_off_20")
    assert every_month["blended_pct"] is None
    assert not any(t["sku"] and t["mechanic_key"] == "pct_off_20" for t in result["targets"])


def test_measure_creates_readable_new_mechanics_and_warns_about_unreadable_ones():
    result = service._measure(_measure_inputs(), CONFIG)

    assert result["to_create"] == {"pct_off_35": {"label": "35% Off", "discount": Decimal("35")}}
    assert any("Free tote bag" in warning for warning in result["warnings"])


def test_measure_with_no_promotions_writes_nothing_to_measure():
    inputs = {**_measure_inputs(), "promotions": {}, "labels": []}

    assert service._measure(inputs, CONFIG)["targets"] == []


# ---- _apply (what gets written) ---------------------------------------------------------


def test_a_new_blended_customer_uplift_is_inserted_as_measured(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())

    counts, results = service._apply(conn, _measured(_target()), _inputs([_setting("pct_off_30")]), CONFIG)

    (_, params), = conn.sql_containing("INSERT INTO promo_uplift_settings")
    assert params["scope"] == "customer"
    assert params["source"] == "measured"
    assert params["uplift_pct"] == Decimal("6.0")
    assert params["changed_by"] == "measurement"
    assert counts["applied"] == 1
    assert results[0][1] == "applied"


def test_an_unchanged_measured_value_writes_nothing(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "measured", "6.0", customer_id=1, row_id=7)]

    counts, _ = service._apply(conn, _measured(_target()), _inputs(settings), CONFIG)

    assert counts["unchanged"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_a_typed_value_is_never_overwritten_and_gets_a_note(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "estimate", "10", customer_id=1, row_id=7)]

    counts, _ = service._apply(conn, _measured(_target()), _inputs(settings), CONFIG)

    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []
    (_, note), = conn.sql_containing("INSERT INTO promo_uplift_pending_notes")
    assert note["status"] == "open"
    assert note["user_value"] == Decimal("10")
    assert note["measured_value"] == Decimal("6.0")
    assert counts["estimate_pending"] == 1


def test_no_blended_sku_uplift_is_written_under_a_typed_blended_customer_uplift(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "estimate", "10", customer_id=1, row_id=7)]

    counts, results = service._apply(conn, _measured(_target(sku="SKU-L")), _inputs(settings), CONFIG)

    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []
    assert results[0][1] == "estimate_pending"


def test_a_backtest_disagreement_holds_the_previous_value(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())

    counts, _ = service._apply(conn, _measured(_target(hold=True)), _inputs([_setting("pct_off_30")]), CONFIG)

    assert counts["held_backtest"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_no_evidence_leaves_the_setting_alone(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())

    counts, _ = service._apply(conn, _measured(_target(blended=None)), _inputs([_setting("pct_off_30")]), CONFIG)

    assert counts["no_evidence"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_archived_mechanics_are_not_measured(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    archived = {**_setting("pct_off_30"), "archived_at": datetime(2026, 9, 1, tzinfo=timezone.utc)}

    counts, _ = service._apply(conn, _measured(_target()), _inputs([archived]), CONFIG)

    assert counts["skipped"] == 1
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_a_declined_note_is_only_raised_again_after_a_two_point_move(monkeypatch):
    settings = [_setting("pct_off_30"), _setting("pct_off_30", "customer", "estimate", "10", customer_id=1, row_id=7)]
    kept = {
        "id": 50, "note_type": "uplift", "customer_id": 1, "mechanic_key": "pct_off_30", "sku": None,
        "setting_id": 7, "anchor_id": None, "user_value": Decimal("10"), "measured_value": Decimal("6"),
        "evidence_months": Decimal("5"), "status": "kept_mine", "declined_value": Decimal("6"),
    }
    notes = {("uplift", 1, "pct_off_30", None): kept}

    conn = _install(monkeypatch, RecordingDatabase())
    service._apply(conn, _measured(_target(blended=7.0)), _inputs(settings, notes), CONFIG)
    assert conn.sql_containing("INSERT INTO promo_uplift_pending_notes") == []

    conn = _install(monkeypatch, RecordingDatabase())
    service._apply(conn, _measured(_target(blended=8.0)), _inputs(settings, notes), CONFIG)
    (_, note), = conn.sql_containing("INSERT INTO promo_uplift_pending_notes")
    assert note["status"] == "open"


def test_new_mechanics_are_created_as_all_customer_rule_based_uplifts(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase())
    measured = _measured(to_create={"pct_off_35": {"label": "35% Off", "discount": Decimal("35")}})

    counts, _ = service._apply(conn, measured, _inputs([]), CONFIG)

    (_, params), = conn.sql_containing("INSERT INTO promo_uplift_settings")
    assert params["mechanic_key"] == "pct_off_35"
    assert params["scope"] == "all"
    assert params["source"] == "rule_based"
    assert params["uplift_pct"] == Decimal("6")
    assert counts["mechanics_created"] == 1


# ---- the run ------------------------------------------------------------------------------


def _no_bigquery():
    raise AssertionError("the measurement must not create a BigQuery client")


def _stub_reads(monkeypatch, inputs=None, config=None):
    monkeypatch.setattr(service.bq, "get_bigquery_client", _no_bigquery)
    monkeypatch.setattr(service, "_read_config", lambda conn: {**CONFIG, **(config or {})})
    base = {
        "window_start": WINDOW[0], "window_end": WINDOW[1], "training": {}, "backtest": None, "settings": [],
        "anchor_views": [], "anchors": {}, "anchor_rows": {}, "rule_rate": Decimal("0.4"),
        "promotions": {}, "store_units": {},
        "customer_stores": {}, "sku_ranges": {}, "labels": [], "notes": {},
    }
    monkeypatch.setattr(service, "_read_inputs", lambda conn: {**base, **(inputs or {})})


def test_unchanged_inputs_record_a_skipped_run_and_nothing_else(monkeypatch):
    _stub_reads(monkeypatch)
    fingerprint = service.mrules.fingerprint(service._fingerprint_payload(
        {"training": {}, "backtest": None, "settings": [], "anchors": {}, "rule_rate": Decimal("0.4"), "promotions": {},
         "store_units": {}, "labels": []}, CONFIG))
    conn = _install(monkeypatch, RecordingDatabase(last_fingerprint=fingerprint))

    summary = service.run_measurement("upload")

    assert summary["status"] == "skipped_unchanged"
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "skipped_unchanged"
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_a_run_writes_its_run_row_once_with_the_counts(monkeypatch):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase())

    summary = service.run_measurement("button")

    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "succeeded"
    assert run["triggered_by"] == "button"
    assert '"applied": 0' in run["counts"]
    assert summary["warnings"] == []


def test_a_second_run_at_the_same_time_is_refused(monkeypatch):
    _stub_reads(monkeypatch)
    _install(monkeypatch, RecordingDatabase(lock_free=False))

    with pytest.raises(service.MeasurementRunningError):
        service.run_measurement("button")


def test_a_failure_is_recorded_as_a_failed_run_and_raised(monkeypatch):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase())

    def broken(inputs, config):
        raise RuntimeError("boom")

    monkeypatch.setattr(service, "_measure", broken)

    with pytest.raises(RuntimeError):
        service.run_measurement("promotion_change")

    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"
    assert "boom" in run["error"]


def test_no_complete_months_of_sales_fails_loudly(monkeypatch):
    monkeypatch.setattr(service, "_read_monthly_sales", lambda conn, current_month: [])
    conn = _install(monkeypatch, RecordingDatabase())

    with pytest.raises(ValueError, match="nothing to measure"):
        service.run_measurement("button")

    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"


@pytest.mark.parametrize("trigger", ["cron", "scheduler"])
def test_an_unknown_trigger_is_rejected_before_anything_runs(trigger):
    with pytest.raises(ValueError):
        service.run_measurement(trigger)


# ---- notes --------------------------------------------------------------------------------


def _open_note(**overrides):
    return {
        "id": 50, "note_type": "uplift", "customer_id": 1, "mechanic_key": "pct_off_30", "sku": None,
        "setting_id": 7, "anchor_id": None, "user_value": Decimal("10"), "measured_value": Decimal("6"),
        "evidence_months": Decimal("5"), "result_id": None, "status": "open", "declined_value": None,
        "superseded_at": None, **overrides,
    }


def test_keep_mine_records_the_declined_value(monkeypatch):
    conn = _install(monkeypatch, RecordingDatabase(note=_open_note()))

    service.keep_mine(50, "sandra")

    (_, note), = conn.sql_containing("INSERT INTO promo_uplift_pending_notes")
    assert note["status"] == "kept_mine"
    assert note["declined_value"] == Decimal("6")
    assert note["decided_by"] == "sandra"


def test_deciding_a_note_twice_is_a_conflict_and_a_missing_one_not_found(monkeypatch):
    _install(monkeypatch, RecordingDatabase(note=_open_note(status="kept_mine")))
    with pytest.raises(service.NoteConflictError):
        service.keep_mine(50)

    _install(monkeypatch, RecordingDatabase(note=None))
    with pytest.raises(service.NoteNotFoundError):
        service.use_measured(50)


# ---- status ---------------------------------------------------------------------------------


def _run_row(status, run_id=1):
    finished = datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc)
    return {
        "run_id": run_id, "triggered_by": "upload", "status": status, "started_at": finished,
        "finished_at": finished, "window_start": None, "window_end": None, "counts": None,
        "warnings": None, "error": "boom" if status == "failed" else None,
    }


def _status_database(last, last_success):
    def respond(sql, params):
        if "status IN ('succeeded', 'succeeded_with_warnings', 'skipped_unchanged')" in sql:
            return [last_success] if last_success else []
        if "FROM promo_measurement_runs" in sql:
            return [last] if last else []
        if "COUNT(*) FROM promo_uplift_pending_notes" in sql:
            return [(0,)]
        return []
    return respond


@pytest.mark.parametrize(
    ("last", "last_success", "stale"),
    [
        (None, None, False),                                          # not measured yet
        (_run_row("succeeded"), _run_row("succeeded"), False),
        (_run_row("failed", 2), _run_row("succeeded"), True),         # the latest run failed
        (_run_row("failed"), None, True),
    ],
)
def test_stale_means_the_latest_run_failed(monkeypatch, last, last_success, stale):
    conn = FakeConnection(_status_database(last, last_success))
    monkeypatch.setattr(common, "get_read_engine", lambda: FakeEngine(conn))

    status = service.measurement_status()

    assert status["stale"] is stale
    assert "next_due" not in status and "stale_days" not in status


# ---- the rule's rate -------------------------------------------------------------


def test_a_rate_change_changes_the_fingerprint():
    base = {"training": {}, "backtest": None, "settings": [], "anchors": {}, "promotions": {},
            "store_units": {}, "labels": []}

    at_04 = service.mrules.fingerprint(service._fingerprint_payload({**base, "rule_rate": Decimal("0.4")}, CONFIG))
    at_06 = service.mrules.fingerprint(service._fingerprint_payload({**base, "rule_rate": Decimal("0.6")}, CONFIG))

    assert at_04 != at_06


def test_the_rule_based_starting_point_uses_the_rate_but_not_for_the_voucher():
    row = _setting("pct_off_30")
    voucher = _setting("voucher", uplift="3", discount=None)

    assert service._rule_based_start(row, "pct_off_30", Decimal("25"), Decimal("0.4")) == 2.0
    assert service._rule_based_start(row, "pct_off_30", Decimal("25"), Decimal("0.6")) == 3.0
    assert service._rule_based_start(voucher, "voucher", Decimal("25"), Decimal("0.6")) == 3.0


# ---- monthly sales from Cloud SQL -----------------------------------------------------------


def _sales_row(customer_id, retailer_id, store, sku, month, units, through=None):
    return {
        "customer_id": customer_id, "retailer_id": retailer_id, "store_code": store, "sku": sku,
        "month": month, "units": units,
        "data_through": through or month.replace(day=service.mrules.days_in_month(month)),
    }


def _store(retailer_id, store):
    return service.uplifts.store_key(retailer_id, store)


def test_the_sales_read_starts_in_january_2025_stops_before_this_month_and_prefers_monthly_rows():
    conn = FakeConnection(lambda sql, params: [])

    service._read_monthly_sales(conn, date(2026, 10, 1))

    (sql, params), = conn.calls
    assert params == {"first_month": date(2025, 1, 1), "current_month": date(2026, 10, 1)}
    assert "es.period_start >= :first_month" in sql
    assert "es.period_start < :current_month" in sql
    # The dashboard's and Inventory's view: monthly rows win over weekly ones for a retailer+month.
    assert "FROM effective_sellout es" in sql and "monthly_coverage" in sql
    assert "JOIN customer_retailers cr ON cr.retailer_id = es.retailer_id" in sql


def test_monthly_sales_add_a_customers_retailers_into_one_customer():
    rows = [
        _sales_row(1, 57, "S1", "SKU-L", date(2025, 1, 1), 60.0),       # fairprice_offline
        _sales_row(1, 55, "ONLINE", "SKU-L", date(2025, 1, 1), 40.0),   # fairprice_online
        _sales_row(2, 456, "N1", "SKU-L", date(2025, 1, 1), 7.0),
    ]

    training, store_units = service._monthly_sales(rows)

    assert training == {1: {"SKU-L": {date(2025, 1, 1): 100.0}}, 2: {"SKU-L": {date(2025, 1, 1): 7.0}}}
    assert store_units[(1, "SKU-L")] == {_store(57, "S1"): 60.0, _store(55, "ONLINE"): 40.0}


def test_a_month_the_customers_data_does_not_reach_the_end_of_is_left_out():
    rows = [
        _sales_row(1, 57, "S1", "SKU-L", date(2026, 9, 1), 100.0),
        # Weekly data only up to 29 Oct: October would read as a drop in sales.
        _sales_row(1, 57, "S1", "SKU-L", date(2026, 10, 1), 80.0, through=date(2026, 10, 29)),
        # Another customer's October is complete, so it stays.
        _sales_row(2, 456, "N1", "SKU-L", date(2026, 10, 1), 9.0),
    ]

    training, store_units = service._monthly_sales(rows)

    assert training[1] == {"SKU-L": {date(2026, 9, 1): 100.0}}
    assert store_units[(1, "SKU-L")] == {_store(57, "S1"): 100.0}
    assert training[2] == {"SKU-L": {date(2026, 10, 1): 9.0}}


def test_a_weekly_row_running_into_the_next_month_completes_its_month():
    rows = [_sales_row(1, 57, "S1", "SKU-L", date(2026, 9, 1), 100.0, through=date(2026, 10, 1))]

    training, _ = service._monthly_sales(rows)

    assert training == {1: {"SKU-L": {date(2026, 9, 1): 100.0}}}


# ---- backtest switched off (the default) ------------------------------------------------------


def test_with_the_backtest_off_every_result_has_no_check_and_nothing_is_held(monkeypatch):
    _stub_reads(monkeypatch, inputs=_measure_inputs())
    monkeypatch.setattr(service, "_read_backtest_errors", _no_bigquery)
    conn = _install(monkeypatch, RecordingDatabase())

    summary = service.run_measurement("button")

    results = [params for _, params in conn.sql_containing("INSERT INTO promo_measurement_results")]
    assert results
    assert all(params["backtest_pct"] is None for params in results)
    assert all(params["outcome"] != "held_backtest" for params in results)
    assert summary["counts"]["held_backtest"] == 0
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert '"backtest_enabled": false' in run["config_snapshot"]


def test_switching_the_backtest_on_reads_it(monkeypatch):
    _stub_reads(monkeypatch, config={"backtest_enabled": True})
    reads = []
    monkeypatch.setattr(service, "_read_backtest_errors", lambda: reads.append(1) or (None, ["no backtest yet"]))
    _install(monkeypatch, RecordingDatabase())

    summary = service.run_measurement("button")

    assert reads == [1]
    assert summary["warnings"] == ["no backtest yet"]


# ---- triggers -------------------------------------------------------------------------------


def _empty_fingerprint():
    return service.mrules.fingerprint(service._fingerprint_payload(
        {"training": {}, "backtest": None, "settings": [], "anchors": {}, "rule_rate": Decimal("0.4"), "promotions": {},
         "store_units": {}, "labels": []}, CONFIG))


@pytest.mark.parametrize("trigger", ["upload", "promotion_change", "button", "page_load", "settings_change"])
def test_each_trigger_measures_when_the_inputs_changed(monkeypatch, trigger):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase(last_fingerprint="an older fingerprint"))

    summary = service.measure_after_change(trigger)

    assert summary["status"] == "succeeded"
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["triggered_by"] == trigger


@pytest.mark.parametrize("trigger", ["upload", "promotion_change", "button", "settings_change"])
def test_an_unchanged_fingerprint_records_a_skip(monkeypatch, trigger):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase(last_fingerprint=_empty_fingerprint()))

    assert service.measure_after_change(trigger)["status"] == "skipped_unchanged"
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "skipped_unchanged"


def test_the_page_load_check_records_nothing_when_unchanged(monkeypatch):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase(last_fingerprint=_empty_fingerprint()))

    summary = service.measure_after_change("page_load")

    assert summary["status"] == "skipped_unchanged"
    assert summary["run_id"] is None
    assert conn.sql_containing("INSERT INTO promo_measurement_runs") == []


def test_an_automatic_trigger_never_raises_and_records_the_failure(monkeypatch):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase())

    def broken(inputs, config):
        raise RuntimeError("boom")

    monkeypatch.setattr(service, "_measure", broken)

    assert service.measure_after_change("upload") == {"status": "failed"}
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"
    assert run["triggered_by"] == "upload"
    assert "boom" in run["error"]


def test_an_automatic_trigger_while_another_run_holds_the_lock_records_nothing(monkeypatch):
    _stub_reads(monkeypatch)
    conn = _install(monkeypatch, RecordingDatabase(lock_free=False))

    assert service.measure_after_change("promotion_change") == {"status": "in_progress"}
    assert conn.sql_containing("INSERT INTO promo_measurement_runs") == []


# ---- the fingerprint only sees promotions overlapping the window ------------------------------


class PromotionsDatabase(RecordingDatabase):
    """RecordingDatabase that also answers the promotion reads, keeping their window WHERE clause."""

    def __init__(self, promotions, **kwargs):
        super().__init__(**kwargs)
        self.promotions = promotions

    def respond(self, sql, params):
        if "FROM promotions p" in sql or "SELECT DISTINCT promotion_mechanic" in sql:
            rows = [
                p for p in self.promotions
                if p["period_end"] >= params["window_start"] and p["period_start"] <= params["window_end"]
            ]
            if "DISTINCT" in sql:
                return sorted({(p["promotion_mechanic"],) for p in rows})
            return rows
        return super().respond(sql, params)


def _promotion_row(promotion_id, label, start, end):
    return {
        "customer_id": 1, "promotion_id": promotion_id, "promo_type": "monthly", "promotion_mechanic": label,
        "voucher": "No", "period_start": start, "period_end": end, "retailer_id": 57, "store_code": "S1",
        "sku": "SKU-L",
    }


def _stub_window_reads(monkeypatch):
    """Sales Jan-Aug 2025 seen from 15 Oct 2025, so the window is Jan-Aug 2025."""

    monkeypatch.setattr(service.bq, "get_bigquery_client", _no_bigquery)
    monkeypatch.setattr(service, "_utc_now", lambda: datetime(2025, 10, 15, 3, 0, tzinfo=timezone.utc))
    read_months = []

    def sales(conn, current_month):
        read_months.append(current_month)
        return [_sales_row(1, 57, "S1", "SKU-L", date(2025, m, 1), 100.0 + m) for m in range(1, 9)]

    monkeypatch.setattr(service, "_read_monthly_sales", sales)
    monkeypatch.setattr(service.uplifts, "_anchors", lambda conn: [])
    monkeypatch.setattr(service.uplifts, "_current_uplift_rows", lambda conn: [
        _setting("pct_off_20", discount="20", uplift="0"), _setting("pct_off_30", row_id=2),
    ])
    monkeypatch.setattr(service.uplifts, "_current_anchor_rows", lambda conn: {})
    monkeypatch.setattr(service.uplifts, "_current_rate", lambda conn: Decimal("0.4"))
    monkeypatch.setattr(service, "_read_customer_stores", lambda conn: {1: {_store(57, "S1")}})
    monkeypatch.setattr(service, "_read_sku_ranges", lambda conn: {})
    monkeypatch.setattr(service, "_read_current_notes", lambda conn: {})
    return read_months


def _count_measures(monkeypatch):
    calls = []
    real = service._measure

    def counting(inputs, config):
        calls.append(1)
        return real(inputs, config)

    monkeypatch.setattr(service, "_measure", counting)
    return calls


def _baseline_fingerprint(monkeypatch, promotions):
    conn = _install(monkeypatch, PromotionsDatabase(promotions))
    service.run_measurement("button")
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    return run["input_fingerprint"]


def test_the_window_ends_with_the_last_complete_month_before_this_one(monkeypatch):
    read_months = _stub_window_reads(monkeypatch)
    conn = _install(monkeypatch, PromotionsDatabase([]))

    summary = service.run_measurement("button")

    assert read_months == [date(2025, 10, 1)]
    assert (summary["window_start"], summary["window_end"]) == ("2025-01-01", "2025-08-31")
    (_, params), = conn.sql_containing("FROM promotions p")
    assert (params["window_start"], params["window_end"]) == (date(2025, 1, 1), date(2025, 8, 31))


def test_creating_a_future_only_promotion_skips_without_measuring(monkeypatch):
    _stub_window_reads(monkeypatch)
    promotions = [_promotion_row(1, "20% Off", date(2025, 3, 1), date(2025, 3, 31))]
    fingerprint = _baseline_fingerprint(monkeypatch, promotions)
    measures = _count_measures(monkeypatch)

    # Planned for December, with a mechanic that isn't in the settings yet.
    promotions.append(_promotion_row(2, "35% Off", date(2025, 12, 1), date(2025, 12, 31)))
    conn = _install(monkeypatch, PromotionsDatabase(promotions, last_fingerprint=fingerprint))
    summary = service.measure_after_change("promotion_change")

    assert summary["status"] == "skipped_unchanged"
    assert measures == []
    assert conn.sql_containing("INSERT INTO promo_uplift_settings") == []


def test_editing_a_promotion_inside_the_window_measures(monkeypatch):
    _stub_window_reads(monkeypatch)
    promotions = [_promotion_row(1, "20% Off", date(2025, 3, 1), date(2025, 3, 31))]
    fingerprint = _baseline_fingerprint(monkeypatch, promotions)
    measures = _count_measures(monkeypatch)

    promotions[0] = _promotion_row(1, "30% Off", date(2025, 3, 1), date(2025, 3, 31))
    _install(monkeypatch, PromotionsDatabase(promotions, last_fingerprint=fingerprint))
    summary = service.measure_after_change("promotion_change")

    assert summary["status"] == "succeeded"
    assert measures == [1]


# ---- settings saves -------------------------------------------------------------------------


def _fingerprint_of(settings):
    return service.mrules.fingerprint(service._fingerprint_payload(
        {"training": {}, "backtest": None, "settings": settings, "anchors": {}, "rule_rate": Decimal("0.4"),
         "promotions": {}, "store_units": {}, "labels": []}, CONFIG))


def test_archiving_or_restoring_a_measured_row_changes_the_fingerprint():
    measured = _setting("pct_off_30", scope="customer", source="measured", uplift="5", customer_id=1, row_id=9)
    archived = {**measured, "archived_at": datetime(2026, 10, 29, tzinfo=timezone.utc)}

    assert _fingerprint_of([_setting("pct_off_30"), measured]) != _fingerprint_of([_setting("pct_off_30"), archived])
    # The measurement's own output (a new measured value) still doesn't count.
    remeasured = {**measured, "uplift_pct": Decimal("6"), "id": 10}
    assert _fingerprint_of([_setting("pct_off_30"), measured]) == _fingerprint_of([_setting("pct_off_30"), remeasured])


def _target_for(measured, key, sku=None):
    return next(t for t in measured["targets"] if t["mechanic_key"] == key and t["sku"] == sku)


def test_a_rule_rate_change_moves_blended_uplifts_slightly_and_rule_based_rows_fully():
    inputs = _measure_inputs()
    at_04 = service._measure({**inputs, "rule_rate": Decimal("0.4")}, CONFIG)
    at_06 = service._measure({**inputs, "rule_rate": Decimal("0.6")}, CONFIG)

    # 30% Off against Fairprice's 20% anchor: the rule-based starting point moves from +4% to +6%.
    customer_04, customer_06 = _target_for(at_04, "pct_off_30"), _target_for(at_06, "pct_off_30")
    assert (customer_04["rule_based_pct"], customer_06["rule_based_pct"]) == (4.0, 6.0)

    # The blended customer uplift moves by k / (N + k) of that: slightly, not by the full 2 points.
    k, big_n = CONFIG["starting_weight"], customer_04["big_n"]
    moved = customer_06["blended_pct"] - customer_04["blended_pct"]
    assert moved == pytest.approx(2.0 * k / (big_n + k))
    assert 0 < moved < 2.0

    # The SKU's blended uplift leans on the customer's, so it moves less again.
    sku_04, sku_06 = _target_for(at_04, "pct_off_30", "SKU-L"), _target_for(at_06, "pct_off_30", "SKU-L")
    assert 0 < sku_06["blended_pct"] - sku_04["blended_pct"] < moved

    # Rule-based rows on the settings page follow the new rate in full: 40% Off, 20 points deeper.
    rows = [_setting("pct_off_40", discount="40", uplift="8")]
    shown = {
        rate: service.uplifts._pick_uplifts(rows, 1, None, None, Decimal("20"), Decimal(rate))[0]["uplift_pct"]
        for rate in ("0.4", "0.6")
    }
    assert shown == {"0.4": 8.0, "0.6": 12.0}


def _note_on_typed_customer_uplift():
    return {
        "id": 70, "note_type": "uplift", "customer_id": 1, "mechanic_key": "pct_off_30", "sku": None,
        "setting_id": 3, "anchor_id": None, "user_value": Decimal("10"), "measured_value": Decimal("6"),
        "evidence_months": Decimal("1"), "status": "open", "declined_value": None,
    }


@pytest.mark.parametrize("archived", [True, False])
def test_archiving_a_mechanic_closes_its_open_notes_in_the_same_request(monkeypatch, archived):
    from fastapi.testclient import TestClient
    from app.main import app

    typed = _setting("pct_off_30", scope="customer", source="estimate", uplift="10", customer_id=1, row_id=3)
    mechanic = _setting("pct_off_30", row_id=2)
    if archived:
        mechanic = {**mechanic, "archived_at": datetime(2026, 10, 29, tzinfo=timezone.utc)}
    inputs = {
        **_measure_inputs(),
        "settings": [_setting("pct_off_20", discount="20", uplift="0"), mechanic, typed],
        "notes": {("uplift", 1, "pct_off_30", None): _note_on_typed_customer_uplift()},
    }
    _stub_reads(monkeypatch, inputs=inputs)
    conn = _install(monkeypatch, RecordingDatabase())
    monkeypatch.setattr(service.uplifts, "archive_uplift", lambda setting_id, by: {"changed": True, "setting": {"id": 2}})

    response = TestClient(app).post("/api/settings/promo-uplifts/2/archive")

    assert response.status_code == 201
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["triggered_by"] == "settings_change"
    closed = [params for _, params in conn.sql_containing("INSERT INTO promo_uplift_pending_notes")
              if params["status"] == "closed"]
    # Archived: its targets are skipped, so the note is untouched and closed. Not archived: the note stays.
    assert len(closed) == (1 if archived else 0)
