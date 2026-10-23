"""
Status-code mapping for POST /api/mappings/{fingerprint}/confirm.

The review screen blocks approval while a low-confidence field is unconfirmed,
but the endpoint is the last gate before a contract is reused for every future
file with these headers, so it holds the same line itself.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.services import notification_service, sellout_ingestion, storage

client = TestClient(app)

ENVELOPE = {
    "raw_columns": [
        "SKU No.",
        "Brand",
        "Vendor",
        "Store Code",
        "Sales | Month 1 | 01-08-2026",
        "Qty | Month 1 | 01-08-2026",
    ],
    "contract": {"identity_mapping": {}, "melt_groups": [], "annotations": {}},
    "name": "Vendor weekly",
    "vendor": "XEL",
}


def _rule(target, source, confidence, reviewed):
    return {
        "targetField": target,
        "sourceColumn": source,
        "sourceColumns": [source],
        "editable": True,
        "confidence": confidence,
        "rationale": "",
        "reviewed": reviewed,
    }


def _complete_rules(rules):
    """Add the other fields a contract needs before it may be approved."""
    return [
        *rules,
        _rule("retailer", "Vendor", "high", False),
        _rule("store_code", "Store Code", "high", False),
        {
            "targetField": "revenue",
            "sourceColumn": "Sales | Month 1 | 01-08-2026",
            "sourceColumns": ["Sales | Month 1 | 01-08-2026"],
            "editable": False,
            "confidence": "high",
            "reviewed": False,
            "meltGroup": {
                "target_field": "revenue",
                "columns": ["Sales | Month 1 | 01-08-2026"],
                "period_extract_regex": r"(\d{2}-\d{2}-\d{4})$",
                "date_format": "%d-%m-%Y",
                "confidence": "high",
                "reviewed": False,
            },
        },
        {
            "targetField": "quantity_units",
            "sourceColumn": "Qty | Month 1 | 01-08-2026",
            "sourceColumns": ["Qty | Month 1 | 01-08-2026"],
            "editable": False,
            "confidence": "high",
            "reviewed": False,
            "meltGroup": {
                "target_field": "quantity_units",
                "columns": ["Qty | Month 1 | 01-08-2026"],
                "period_extract_regex": r"(\d{2}-\d{2}-\d{4})$",
                "date_format": "%d-%m-%Y",
                "confidence": "high",
                "reviewed": False,
            },
        },
    ]


def _stub_storage(monkeypatch):
    """Serve ENVELOPE as the pending blob and record what gets stored."""
    stored = {}

    monkeypatch.setattr(
        storage,
        "download_json",
        lambda path: ENVELOPE if path == storage.pending_mapping_path("fp") else None,
    )

    def move(fingerprint, envelope):
        stored["envelope"] = envelope
        return {
            "stored_at": "gs://bucket/mappings/confirmed/fp.json",
            "pending_path": "mappings/pending/fp.json",
            "confirmed_path": "mappings/confirmed/fp.json",
            "removed_pending": True,
        }

    monkeypatch.setattr(storage, "move_pending_mapping_to_confirmed", move)
    monkeypatch.setattr(
        storage, "update_uploads_for_mapping", lambda fingerprint, metadata: {"updated": []}
    )
    return stored


# ---- Low-confidence gate ------------------------------------------------------

def test_confirm_rejects_missing_required_ingest_fields(monkeypatch):
    stored = _stub_storage(monkeypatch)
    rules = [_rule("sku", "SKU No.", "high", False)]

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 422
    assert "retailer" in response.json()["detail"]["message"]
    assert "envelope" not in stored


def test_confirm_rejects_an_unreviewed_low_confidence_field_with_422(monkeypatch):
    stored = _stub_storage(monkeypatch)
    rules = [
        _rule("sku", "SKU No.", "high", False),
        _rule("brand", "Brand", "low", False),
    ]

    response = client.post(
        "/api/mappings/fp/confirm", json={"rules": _complete_rules(rules)}
    )

    assert response.status_code == 422
    assert "brand" in response.json()["detail"]["message"]
    assert "envelope" not in stored


def test_confirm_stores_a_reviewed_low_confidence_field_as_reviewed(monkeypatch):
    stored = _stub_storage(monkeypatch)
    rules = [
        _rule("sku", "SKU No.", "high", False),
        _rule("brand", "Brand", "low", True),
    ]

    response = client.post(
        "/api/mappings/fp/confirm", json={"rules": _complete_rules(rules)}
    )

    assert response.status_code == 200
    brand = stored["envelope"]["contract"]["annotations"]["brand"]
    assert brand == {"confidence": "low", "rationale": "", "reviewed": True}


def test_confirm_processes_uploads_that_were_waiting_for_approval(monkeypatch):
    _stub_storage(monkeypatch)
    monkeypatch.setattr(
        storage,
        "update_uploads_for_mapping",
        lambda fingerprint, metadata: {
            "matched": ["uploads/file.txt"],
            "updated": ["uploads/file.txt"],
        },
    )
    monkeypatch.setattr(
        storage,
        "download_upload",
        lambda path: ("file.txt", b"source bytes"),
    )
    calls = []

    def process(filename, data, contract, *, replace_source=False):
        calls.append((filename, data, contract, replace_source))
        return {"rows_stored": 10, "storage_status": "completed"}

    monkeypatch.setattr(sellout_ingestion, "process_confirmed_upload", process)
    rules = [
        _rule("sku", "SKU No.", "high", False),
        _rule("brand", "Brand", "high", False),
    ]

    response = client.post(
        "/api/mappings/fp/confirm", json={"rules": _complete_rules(rules)}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["uploads_processed"] == 1
    assert body["uploads_failed"] == 0
    assert body["processing"][0]["processing"]["rows_stored"] == 10
    assert calls[0][0:2] == ("file.txt", b"source bytes")
    assert calls[0][3] is True


# ---- A pending copy left behind after approval --------------------------------

STALE_PENDING = {**ENVELOPE, "name": None, "vendor": None}


def _serve(monkeypatch, blobs):
    monkeypatch.setattr(storage, "download_json", lambda path: blobs.get(path))


def test_amending_builds_on_the_confirmed_copy_not_a_stale_pending_one(monkeypatch):
    stored = _stub_storage(monkeypatch)
    _serve(
        monkeypatch,
        {
            storage.pending_mapping_path("fp"): STALE_PENDING,
            storage.confirmed_mapping_path("fp"): ENVELOPE,
        },
    )
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    # No name or vendor sent: an amendment inherits them from what is confirmed.
    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 200
    assert stored["envelope"]["name"] == "Vendor weekly"
    assert stored["envelope"]["vendor"] == "XEL"


def test_listing_leaves_out_a_pending_copy_that_has_been_confirmed(monkeypatch):
    fingerprints = {"confirmed": ["fp"], "pending": ["fp", "new"]}
    monkeypatch.setattr(storage, "list_mapping_fingerprints", lambda state: fingerprints[state])
    _serve(
        monkeypatch,
        {
            storage.confirmed_mapping_path("fp"): ENVELOPE,
            storage.pending_mapping_path("fp"): STALE_PENDING,
            storage.pending_mapping_path("new"): ENVELOPE,
        },
    )

    response = client.get("/api/mappings")

    listed = [(m["fingerprint"], m["state"]) for m in response.json()["mappings"]]
    assert listed == [("fp", "confirmed"), ("new", "pending")]


# ---- approving a mapping raises a notification ----------------------------------


def _capture_notifications(monkeypatch):
    sent = []
    monkeypatch.setattr(notification_service, "insert_best_effort", lambda kind, payload: sent.append((kind, payload)))
    return sent


def test_a_first_approval_raises_a_new_mapping_notification(monkeypatch):
    _stub_storage(monkeypatch)
    sent = _capture_notifications(monkeypatch)
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 200
    assert sent == [(
        "mapping_uploaded",
        {"name": "Vendor weekly", "vendor": "XEL", "amended": False, "uploads_processed": 0, "uploads_failed": 0},
    )]


def test_re_approving_a_confirmed_mapping_is_marked_as_an_amendment(monkeypatch):
    _stub_storage(monkeypatch)
    _serve(monkeypatch, {storage.confirmed_mapping_path("fp"): ENVELOPE})
    sent = _capture_notifications(monkeypatch)
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert sent[0][1]["amended"] is True


def test_an_approval_still_succeeds_when_its_notification_cannot_be_written(monkeypatch):
    # The real insert_best_effort, against the blocked test database.
    _stub_storage(monkeypatch)
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 200
