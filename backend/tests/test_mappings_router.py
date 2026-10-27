"""
Status-code mapping for POST /api/mappings/{fingerprint}/confirm.

The review screen blocks approval while a low-confidence field is unconfirmed,
but the endpoint is the last gate before a contract is reused for every future
file with these headers, so it holds the same line itself.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.services import customer_service, notification_service, sellout_ingestion, storage

client = TestClient(app)

ENVELOPE = {
    "raw_columns": [
        "SKU No.",
        "Store Name",
        "Vendor",
        "Store Code",
        "Sales | Month 1 | 01-08-2026",
        "Qty | Month 1 | 01-08-2026",
    ],
    "contract": {"identity_mapping": {}, "melt_groups": [], "annotations": {}},
    "name": "Vendor weekly",
    "vendor": "xel",
    "customer_id": 3,
    "customer_name": "xel",
}

CUSTOMER = {
    "customer_id": 3,
    "customer_name": "xel",
    "retailers": [{"retailer_id": 8, "retailer_name": "xel_offline"}],
    "in_use": False,
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
    monkeypatch.setattr(
        customer_service, "get_customer", lambda customer_id: CUSTOMER if customer_id == 3 else None
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
        _rule("store_name", "Store Name", "low", False),
    ]

    response = client.post(
        "/api/mappings/fp/confirm", json={"rules": _complete_rules(rules)}
    )

    assert response.status_code == 422
    assert "store_name" in response.json()["detail"]["message"]
    assert "envelope" not in stored


def test_confirm_stores_a_reviewed_low_confidence_field_as_reviewed(monkeypatch):
    stored = _stub_storage(monkeypatch)
    rules = [
        _rule("sku", "SKU No.", "high", False),
        _rule("store_name", "Store Name", "low", True),
    ]

    response = client.post(
        "/api/mappings/fp/confirm", json={"rules": _complete_rules(rules)}
    )

    assert response.status_code == 200
    # Confirmed in version 1, so stored back in version 1 for today's
    # transformation.
    contract = stored["envelope"]["contract"]
    assert contract["identity_mapping"]["Store Name"] == "store_name"
    assert contract["annotations"]["store_name"] == {"confidence": "low", "rationale": "", "reviewed": True}
    assert response.json()["contract_format"] == 1


def test_confirm_records_what_the_reviewer_changed_and_numbers_the_version(monkeypatch):
    stored = _stub_storage(monkeypatch)
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 200
    envelope = stored["envelope"]
    assert envelope["version"] == 1
    changed = {change.get("field") for change in envelope["reviewer_diff"]}
    assert {"sku", "retailer", "store_code"} <= changed
    assert envelope["edited_by_user"] is True


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
        _rule("store_name", "Store Name", "high", False),
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
    assert "identity_mapping" in calls[0][2]


# ---- A pending copy left behind after approval --------------------------------

STALE_PENDING = {**ENVELOPE, "name": None, "vendor": None, "customer_id": None, "customer_name": None}


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

    # No name or customer sent: an amendment inherits them from what is confirmed.
    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 200
    assert stored["envelope"]["name"] == "Vendor weekly"
    assert stored["envelope"]["vendor"] == "xel"
    assert stored["envelope"]["customer_id"] == 3


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


def test_confirming_edited_rules_keeps_the_contracts_data_source(monkeypatch):
    stored = _stub_storage(monkeypatch)
    monkeypatch.setattr(
        storage,
        "download_json",
        lambda path: {**ENVELOPE, "contract": {"version": 2, "fields": {}, "melt_groups": [], "data_source": "promo_claim"}}
        if path == storage.pending_mapping_path("fp")
        else None,
    )
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 200
    assert stored["envelope"]["contract"]["data_source"] == "promo_claim"


# ---- Version 2 contracts ---------------------------------------------------------------

V2_ENVELOPE = {
    **ENVELOPE,
    "contract": {"version": 2, "fields": {}, "melt_groups": [], "aggregate": {"period": "month"}},
}


def test_a_version_2_mapping_is_confirmed_and_waiting_uploads_are_processed(monkeypatch):
    stored = _stub_storage(monkeypatch)
    monkeypatch.setattr(
        storage, "download_json",
        lambda path: V2_ENVELOPE if path == storage.pending_mapping_path("fp") else None,
    )
    monkeypatch.setattr(
        storage, "update_uploads_for_mapping",
        lambda fingerprint, metadata: {"matched": ["uploads/file.txt"], "updated": ["uploads/file.txt"]},
    )
    monkeypatch.setattr(storage, "download_upload", lambda path: ("file.txt", b"source"))
    calls = []

    def process(filename, data, contract, *, replace_source=False):
        calls.append((filename, data, contract, replace_source))
        return {"rows_stored": 4, "storage_status": "completed"}

    monkeypatch.setattr(sellout_ingestion, "process_confirmed_upload", process)

    response = client.post("/api/mappings/fp/confirm", json={"rules": _complete_rules([_rule("sku", "SKU No.", "high", False)])})

    assert response.status_code == 200
    body = response.json()
    assert body["contract_format"] == 2
    assert "awaiting_transformation" not in body
    assert body["uploads_processed"] == 1
    assert body["processing"][0]["processing"]["rows_stored"] == 4
    assert calls[0][0:2] == ("file.txt", b"source")
    assert calls[0][3] is True
    # The roll-up instruction is kept although the rules do not carry it.
    assert stored["envelope"]["contract"]["aggregate"]["period"] == "month"


def test_confirming_is_blocked_while_a_product_code_is_not_a_master_sku(monkeypatch):
    import io

    from app.services import generate_mapping

    stored = _stub_storage(monkeypatch)
    csv = b"SKU No.,Store Name,Vendor,Store Code,Sales | Month 1 | 01-08-2026,Qty | Month 1 | 01-08-2026\n99999999,A,V,1,10,1\n"
    envelope = {**V2_ENVELOPE, "example_file": "uploads/x.csv", "source_filename": "x.csv"}
    monkeypatch.setattr(storage, "download_json", lambda path: envelope if path == storage.pending_mapping_path("fp") else None)
    monkeypatch.setattr(storage, "download_bytes", lambda path: csv)
    monkeypatch.setattr(generate_mapping.catalog_service, "get_skus", lambda: [{"sku": "13255043"}])

    response = client.post("/api/mappings/fp/confirm", json={"rules": _complete_rules([_rule("sku", "SKU No.", "high", False)])})

    assert response.status_code == 422
    assert "99999999" in response.json()["detail"]["message"]
    assert "envelope" not in stored


# ---- The customer a mapping belongs to -------------------------------------------------

def _serve_pending(monkeypatch, envelope):
    monkeypatch.setattr(
        storage, "download_json",
        lambda path: envelope if path == storage.pending_mapping_path("fp") else None,
    )


def _constant_retailer_rules(value):
    """Complete rules with the retailer a constant, as for NHG."""
    rules = [rule for rule in _complete_rules([_rule("sku", "SKU No.", "high", False)]) if rule["targetField"] != "retailer"]
    return [
        *rules,
        {
            "targetField": "retailer",
            "sourceColumn": "",
            "sourceColumns": [],
            "editable": False,
            "confidence": "high",
            "reviewed": False,
            "field": {"status": "constant", "value": value},
        },
    ]


def test_a_first_approval_without_a_customer_is_422_and_stores_nothing(monkeypatch):
    stored = _stub_storage(monkeypatch)
    _serve_pending(monkeypatch, STALE_PENDING)

    response = client.post(
        "/api/mappings/fp/confirm", json={"name": "XEL weekly", "rules": _constant_retailer_rules("xel_offline")}
    )

    assert response.status_code == 422
    assert "customer" in response.json()["detail"]
    assert "envelope" not in stored


def test_an_unknown_customer_is_404(monkeypatch):
    stored = _stub_storage(monkeypatch)
    _serve_pending(monkeypatch, STALE_PENDING)

    response = client.post(
        "/api/mappings/fp/confirm",
        json={"name": "XEL weekly", "customer_id": 99, "rules": _constant_retailer_rules("xel_offline")},
    )

    assert response.status_code == 404
    assert "envelope" not in stored


def test_a_retailer_outside_the_customer_blocks_approval_with_its_name(monkeypatch):
    stored = _stub_storage(monkeypatch)
    _serve_pending(monkeypatch, STALE_PENDING)

    response = client.post(
        "/api/mappings/fp/confirm",
        json={"name": "XEL weekly", "customer_id": 3, "rules": _constant_retailer_rules("giant_offline")},
    )

    assert response.status_code == 422
    assert "giant_offline" in response.json()["detail"]["message"]
    assert "envelope" not in stored


def test_approval_records_the_customer_and_writes_its_name_as_the_vendor(monkeypatch):
    stored = _stub_storage(monkeypatch)
    _serve_pending(monkeypatch, STALE_PENDING)

    response = client.post(
        "/api/mappings/fp/confirm",
        json={"name": "XEL weekly", "customer_id": 3, "rules": _constant_retailer_rules("xel_offline")},
    )

    assert response.status_code == 200
    envelope = stored["envelope"]
    assert (envelope["customer_id"], envelope["customer_name"], envelope["vendor"]) == (3, "xel", "xel")
    assert response.json()["customer_name"] == "xel"


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
        # The vendor is the customer's name: approval writes it (see CUSTOMER).
        {"name": "Vendor weekly", "vendor": "xel", "amended": False, "uploads_processed": 0, "uploads_failed": 0},
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
