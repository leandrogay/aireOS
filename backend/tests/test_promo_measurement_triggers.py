"""
What starts a promotion uplift measurement, through HTTP: a sales upload or a
confirmed Load that stored rows (approving a mapping loads nothing, so it
never measures), a promotion created / edited / deleted, the Re-measure button and
the settings page opening, and settings saves that can change a measured
value. A measurement failure never fails the upload, the promotion change or
the save; it is recorded as a failed run instead.
"""

import pytest
from conftest import FakeConnection, FakeEngine
from fastapi.testclient import TestClient

from app.main import app
from app.routers import uploads
from app.services import promotion_service, storage, upload_loading
from app.services.settings import common
from app.services.settings import promo_measurement as measurement
from app.services.settings import promo_uplifts as uplift_service

client = TestClient(app)

PROMOTION = {
    "stores": [{"retailer": "fairprice_offline", "store_name": "Bedok", "store_code": "S1", "store_format": "Hyper"}],
    "period_start": "2026-11-01",
    "period_end": "2026-11-30",
    "period_label": "Nov 2026",
    "promo_type": "monthly",
    "promotion_mechanic": "30% Off",
    "voucher": "No",
    "skus": [{"sku": "SKU-L", "sku_range": "Pants"}],
}


def _record_triggers(monkeypatch):
    triggers = []
    monkeypatch.setattr(measurement, "measure_after_change", lambda trigger: triggers.append(trigger) or {})
    return triggers


def _failing_measurement(monkeypatch):
    """A real measure_after_change whose run breaks: returns the recorded runs."""

    def respond(sql, params):
        if "pg_try_advisory_xact_lock" in sql:
            return [(True,)]
        if "RETURNING" in sql:
            return [(1,)]
        return []

    conn = FakeConnection(respond)
    monkeypatch.setattr(common, "get_engine", lambda: FakeEngine(conn))

    def broken(conn):
        raise RuntimeError("measurement broke")

    monkeypatch.setattr(measurement, "_read_inputs", broken)
    return conn


# ---- promotion changes ------------------------------------------------------------------------


def _stub_promotion_service(monkeypatch, found=True):
    monkeypatch.setattr(promotion_service, "create_promotion", lambda body: {"promotion_id": 7})
    monkeypatch.setattr(promotion_service, "update_promotion", lambda _id, body: {"promotion_id": 7} if found else None)
    monkeypatch.setattr(promotion_service, "delete_promotion", lambda _id: found)


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [("post", "/api/promotions", 201), ("put", "/api/promotions/7", 200), ("delete", "/api/promotions/7", 200)],
)
def test_a_promotion_change_measures(monkeypatch, method, path, status):
    _stub_promotion_service(monkeypatch)
    triggers = _record_triggers(monkeypatch)

    response = client.request(method, path, json=PROMOTION if method != "delete" else None)

    assert response.status_code == status
    assert triggers == ["promotion_change"]


@pytest.mark.parametrize(("method", "path"), [("put", "/api/promotions/7"), ("delete", "/api/promotions/7")])
def test_a_missing_promotion_does_not_measure(monkeypatch, method, path):
    _stub_promotion_service(monkeypatch, found=False)
    triggers = _record_triggers(monkeypatch)

    response = client.request(method, path, json=PROMOTION if method != "delete" else None)

    assert response.status_code == 404
    assert triggers == []


def test_a_failed_measurement_does_not_fail_the_promotion_change_and_is_recorded(monkeypatch):
    _stub_promotion_service(monkeypatch)
    conn = _failing_measurement(monkeypatch)

    response = client.post("/api/promotions", json=PROMOTION)

    assert response.status_code == 201
    assert response.json() == {"promotion_id": 7}
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"
    assert run["triggered_by"] == "promotion_change"
    assert "measurement broke" in run["error"]


# ---- sales uploads ----------------------------------------------------------------------------


def _stub_upload(monkeypatch, rows_stored):
    monkeypatch.setattr(storage, "upload_many", lambda payload, force, keep_duplicate: {
        "results": [{"success": True, "destination": "gs://bucket/uploads/a.csv", "blob_path": "uploads/a.csv"}],
    })
    monkeypatch.setattr(uploads, "resolve_and_apply_mapping", lambda *args: {
        "status": "mapped", "processing": {"rows_stored": rows_stored, "storage_status": "completed"},
    })
    monkeypatch.setattr(storage, "annotate_upload", lambda blob_path, annotations: None)


def _upload():
    return client.post("/api/uploads", files=[("files", ("a.csv", b"sku,qty\n", "text/csv"))])


def test_an_upload_that_stored_rows_measures_once(monkeypatch):
    _stub_upload(monkeypatch, rows_stored=12)
    triggers = _record_triggers(monkeypatch)

    response = _upload()

    assert response.status_code == 200
    assert triggers == ["upload"]


def test_an_upload_that_stored_nothing_does_not_measure(monkeypatch):
    _stub_upload(monkeypatch, rows_stored=0)
    triggers = _record_triggers(monkeypatch)

    assert _upload().status_code == 200
    assert triggers == []


def test_a_failed_measurement_does_not_fail_the_upload_and_is_recorded(monkeypatch):
    _stub_upload(monkeypatch, rows_stored=12)
    conn = _failing_measurement(monkeypatch)

    response = _upload()

    assert response.status_code == 200
    assert response.json()["results"][0]["mapping"]["processing"]["rows_stored"] == 12
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"
    assert run["triggered_by"] == "upload"


# ---- confirmed loads (POST /api/uploads/load) ------------------------------------------------


def _stub_load(monkeypatch, *rows_stored):
    monkeypatch.setattr(upload_loading, "load_uploads", lambda blob_paths: [
        {"blob_path": f"uploads/{index}.csv", "success": True, "processing": {"rows_stored": rows}}
        for index, rows in enumerate(rows_stored)
    ])


def _load():
    return client.post("/api/uploads/load", json={"blob_paths": ["uploads/0.csv", "uploads/1.csv"]})


def test_a_load_that_stored_rows_measures_once(monkeypatch):
    _stub_load(monkeypatch, 12, 5)
    triggers = _record_triggers(monkeypatch)

    response = _load()

    assert response.status_code == 200
    assert response.json()["loaded"] == 2
    assert triggers == ["upload"]


def test_a_load_that_stored_nothing_does_not_measure(monkeypatch):
    _stub_load(monkeypatch, 0, 0)
    triggers = _record_triggers(monkeypatch)

    assert _load().status_code == 200
    assert triggers == []


def test_a_failed_measurement_does_not_fail_the_load_and_is_recorded(monkeypatch):
    _stub_load(monkeypatch, 12)
    conn = _failing_measurement(monkeypatch)

    response = _load()

    assert response.status_code == 200
    assert response.json()["loaded"] == 1
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"
    assert run["triggered_by"] == "upload"


# ---- the settings page ------------------------------------------------------------------------


def test_re_measure_runs_as_the_button(monkeypatch):
    triggers = []
    monkeypatch.setattr(measurement, "run_measurement", lambda trigger: triggers.append(trigger) or {"status": "succeeded"})

    assert client.post("/api/settings/promo-uplifts/measure").status_code == 200
    assert triggers == ["button"]


def test_opening_the_page_checks_as_page_load(monkeypatch):
    triggers = _record_triggers(monkeypatch)

    assert client.post("/api/settings/promo-uplifts/measure/if-changed").status_code == 200
    assert triggers == ["page_load"]


def test_the_page_load_check_never_fails_the_page(monkeypatch):
    conn = _failing_measurement(monkeypatch)

    response = client.post("/api/settings/promo-uplifts/measure/if-changed")

    assert response.status_code == 200
    assert response.json() == {"status": "failed"}
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["triggered_by"] == "page_load"


# ---- settings saves -----------------------------------------------------------------------


SETTINGS = "/api/settings/promo-uplifts"
SAVED = {
    "setting": {"id": 8, "mechanic_key": "pct_off_30", "uplift_pct": 6.0, "source": "estimate"},
    "anchor": {"customer_id": 1, "customer_name": "fairprice", "anchor_pct": 25.0, "source": "manual"},
    "rule": {"uplift_per_point_pct": 0.6},
}
SETTINGS_SAVES = [
    ("set_rule", "put", "/rule", {"uplift_per_point_pct": 0.6}),
    ("reset_rule", "post", "/rule/reset", None),
    ("set_anchor", "put", "/anchors/1", {"anchor_pct": 25}),
    ("set_anchor", "put", "/anchors/default", {"anchor_pct": 30}),
    ("reset_anchor", "post", "/anchors/1/reset", None),
    ("update_uplift", "put", "/8", {"uplift_pct": 6}),
    ("reset_uplift", "post", "/8/reset", None),
    ("archive_uplift", "post", "/8/archive", None),
    ("restore_uplift", "post", "/8/restore", None),
    ("add_mechanic", "post", "/mechanics", {"mechanic_label": "35% Off"}),
    ("add_override", "post", "", {"mechanic_key": "pct_off_30", "scope": "customer", "customer_id": 1, "uplift_pct": 7}),
]


def _stub_save(monkeypatch, name, changed):
    monkeypatch.setattr(uplift_service, name, lambda *args, **kwargs: {"changed": changed, **SAVED})


@pytest.mark.parametrize(("name", "method", "path", "body"), SETTINGS_SAVES)
def test_a_settings_save_that_wrote_a_version_measures(monkeypatch, name, method, path, body):
    _stub_save(monkeypatch, name, changed=True)
    triggers = []
    monkeypatch.setattr(measurement, "measure_after_change",
                        lambda trigger: triggers.append(trigger) or {"status": "succeeded", "counts": {"applied": 2}})

    response = client.request(method, f"{SETTINGS}{path}", json=body)

    assert response.status_code == 201
    assert triggers == ["settings_change"]
    assert response.json()["measurement"] == {"status": "succeeded", "counts": {"applied": 2}}


@pytest.mark.parametrize(("name", "method", "path", "body"), SETTINGS_SAVES)
def test_a_settings_save_that_changed_nothing_does_not_measure(monkeypatch, name, method, path, body):
    _stub_save(monkeypatch, name, changed=False)
    triggers = _record_triggers(monkeypatch)

    response = client.request(method, f"{SETTINGS}{path}", json=body)

    assert response.status_code == 200
    assert triggers == []
    assert "measurement" not in response.json()


@pytest.mark.parametrize(
    ("note_type", "sku", "measures"),
    [
        ("anchor", None, True),      # the anchor goes back to the suggestion
        ("uplift", None, True),      # a customer value: unblocks the SKU values below it
        ("uplift", "SKU-L", False),  # a SKU value: provably moves no measured value
    ],
)
def test_use_measured_measures_unless_it_was_a_sku_note(monkeypatch, note_type, sku, measures):
    monkeypatch.setattr(measurement, "use_measured",
                        lambda note_id, by: {"changed": True, "note_type": note_type, "sku": sku})
    triggers = _record_triggers(monkeypatch)

    assert client.post(f"{SETTINGS}/notes/5/use-measured").status_code == 200
    assert triggers == (["settings_change"] if measures else [])


def test_keep_mine_never_measures(monkeypatch):
    monkeypatch.setattr(measurement, "keep_mine", lambda note_id, by: {"changed": True})
    triggers = _record_triggers(monkeypatch)

    assert client.post(f"{SETTINGS}/notes/5/keep-mine").status_code == 200
    assert triggers == []


def test_a_failed_measurement_does_not_fail_the_settings_save_and_is_recorded(monkeypatch):
    _stub_save(monkeypatch, "set_rule", changed=True)
    conn = _failing_measurement(monkeypatch)

    response = client.put(f"{SETTINGS}/rule", json={"uplift_per_point_pct": 0.6})

    assert response.status_code == 201
    assert response.json()["rule"] == {"uplift_per_point_pct": 0.6}
    assert response.json()["measurement"] == {"status": "failed"}
    (_, run), = conn.sql_containing("INSERT INTO promo_measurement_runs")
    assert run["status"] == "failed"
    assert run["triggered_by"] == "settings_change"
