"""
Status-code mapping for POST /api/mappings/{fingerprint}/confirm.

The review screen blocks approval while a low-confidence field is unconfirmed,
but the endpoint is the last gate before a contract is reused for every future
file with these headers, so it holds the same line itself.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.services import customer_service, notification_service, sellout_ingestion, storage, upload_loading

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
        upload_loading,
        "mark_uploads_after_approval",
        lambda fingerprint, **kwargs: {"waiting": [], "outdated": [], "updated": 0},
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


def _no_load_allowed(*args, **kwargs):
    raise AssertionError("approving a mapping must not load anything into sell-out")


def test_approval_marks_waiting_uploads_ready_and_loads_nothing(monkeypatch):
    _stub_storage(monkeypatch)
    marked = []

    def mark(fingerprint, *, name, vendor, version):
        marked.append((fingerprint, name, vendor, version))
        return {
            "waiting": [{"blob_path": "uploads/file.txt", "filename": "file.txt", "uploaded_at": None, "mapping_status": "ready_to_load"}],
            "outdated": [],
            "updated": 1,
        }

    monkeypatch.setattr(upload_loading, "mark_uploads_after_approval", mark)
    monkeypatch.setattr(sellout_ingestion, "process_confirmed_upload", _no_load_allowed)
    rules = [
        _rule("sku", "SKU No.", "high", False),
        _rule("store_name", "Store Name", "high", False),
    ]

    response = client.post(
        "/api/mappings/fp/confirm", json={"rules": _complete_rules(rules)}
    )

    assert response.status_code == 200
    body = response.json()
    assert [item["blob_path"] for item in body["waiting_uploads"]] == ["uploads/file.txt"]
    assert body["outdated_uploads"] == []
    assert "processing" not in body
    assert marked == [("fp", "Vendor weekly", "xel", 1)]


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


def test_a_version_2_mapping_is_confirmed_without_loading_its_uploads(monkeypatch):
    stored = _stub_storage(monkeypatch)
    monkeypatch.setattr(
        storage, "download_json",
        lambda path: V2_ENVELOPE if path == storage.pending_mapping_path("fp") else None,
    )
    monkeypatch.setattr(sellout_ingestion, "process_confirmed_upload", _no_load_allowed)

    response = client.post("/api/mappings/fp/confirm", json={"rules": _complete_rules([_rule("sku", "SKU No.", "high", False)])})

    assert response.status_code == 200
    body = response.json()
    assert body["contract_format"] == 2
    assert "awaiting_transformation" not in body
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
        {"name": "Vendor weekly", "vendor": "xel", "amended": False, "uploads_waiting": 0, "uploads_outdated": 0},
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


# ---- Testing a mapping on its example file -------------------------------------------

EXAMPLE_CSV = b"SKU No.,Store Name,Vendor,Store Code,Sales | Month 1 | 01-08-2026,Qty | Month 1 | 01-08-2026\n13255043,A,V,1,10,1\n"


def _serve_example(monkeypatch, blobs, uploads):
    """Serve a pending envelope whose example file is uploads/old.csv, and these blobs and uploads."""
    from app.services import generate_mapping

    envelope = {**V2_ENVELOPE, "example_file": "uploads/old.csv", "source_filename": "old.csv"}
    _serve_pending(monkeypatch, envelope)
    monkeypatch.setattr(storage, "download_bytes", lambda path: blobs.get(path))
    monkeypatch.setattr(storage, "list_uploads_for_mapping", lambda fingerprint: uploads if fingerprint == "fp" else [])
    monkeypatch.setattr(generate_mapping.catalog_service, "get_skus", lambda: [{"sku": "13255043"}])


def test_a_replaced_example_file_is_tested_on_the_newest_copy_of_its_layout(monkeypatch):
    read = []
    blobs = {"uploads/new.csv": EXAMPLE_CSV}
    _serve_example(monkeypatch, blobs, [
        {"blob_path": "uploads/older.csv", "filename": "older.csv"},
        {"blob_path": "uploads/new.csv", "filename": "new.csv"},
    ])
    monkeypatch.setattr(storage, "download_bytes", lambda path: read.append(path) or blobs.get(path))

    response = client.post("/api/mappings/fp/preview", json={})

    assert response.status_code == 200
    assert read == ["uploads/old.csv", "uploads/new.csv"]


def test_testing_with_no_copy_of_the_example_file_left_is_410_and_says_what_to_do(monkeypatch):
    _serve_example(monkeypatch, {}, [{"blob_path": "uploads/gone.csv", "filename": "gone.csv"}])

    response = client.post("/api/mappings/fp/preview", json={})

    assert response.status_code == 410
    assert "Upload a file with these columns" in response.json()["detail"]


def test_testing_returns_sample_rows_even_while_a_check_fails(monkeypatch):
    from app.services import generate_mapping

    _serve_example(monkeypatch, {"uploads/old.csv": EXAMPLE_CSV}, [])
    # 13255043 is not a master SKU here, so the product-code check fails.
    monkeypatch.setattr(generate_mapping.catalog_service, "get_skus", lambda: [{"sku": "99999999"}])
    rules = _complete_rules([_rule("sku", "SKU No.", "high", True)])

    response = client.post("/api/mappings/fp/preview", json={"rules": rules})

    body = response.json()
    assert response.status_code == 200
    assert any(check["id"] == "sku_codes" and not check["passed"] for check in body["checks"])
    assert body["rows_total"] == 1
    assert body["preview"][0]["sku"] == "13255043"
    assert body["preview_error"] is None


def test_testing_returns_the_example_files_layout_and_first_rows(monkeypatch):
    _serve_example(monkeypatch, {"uploads/old.csv": EXAMPLE_CSV}, [])

    body = client.post("/api/mappings/fp/preview", json={}).json()

    assert body["layout"]["header_row"] == 1
    assert body["head_rows"] == [["13255043", "A", "V", "1", "10", "1"]]


def test_rules_that_cannot_run_report_why_beside_their_checks(monkeypatch):
    _serve_example(monkeypatch, {"uploads/old.csv": EXAMPLE_CSV}, [])
    monkeypatch.setattr(
        sellout_ingestion,
        "transform_confirmed_upload",
        lambda *args: (_ for _ in ()).throw(sellout_ingestion.apply_contract.ContractApplicationError("no period stated")),
    )

    body = client.post("/api/mappings/fp/preview", json={}).json()

    assert body["preview_error"] == "no period stated"
    assert body["checks"]


# ---- Contract-wide settings the reviewer changes -----------------------------------

def test_the_reviewer_can_turn_the_monthly_roll_up_off_and_tag_a_claim_statement(monkeypatch):
    stored = _stub_storage(monkeypatch)
    _serve_pending(monkeypatch, V2_ENVELOPE)
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    response = client.post(
        "/api/mappings/fp/confirm",
        json={"rules": rules, "instructions": {"aggregate": False, "data_source": "promo_claim"}},
    )

    assert response.status_code == 200
    assert stored["envelope"]["contract"]["aggregate"] is None
    assert stored["envelope"]["contract"]["data_source"] == "promo_claim"


def test_settings_left_out_are_kept_as_stored(monkeypatch):
    stored = _stub_storage(monkeypatch)
    _serve_pending(monkeypatch, V2_ENVELOPE)
    rules = _complete_rules([_rule("sku", "SKU No.", "high", False)])

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules, "instructions": {}})

    assert response.status_code == 200
    assert stored["envelope"]["contract"]["aggregate"]["period"] == "month"


def test_an_unknown_data_type_is_rejected_with_422(monkeypatch):
    _stub_storage(monkeypatch)

    response = client.post("/api/mappings/fp/confirm", json={"rules": [], "instructions": {"data_source": "guess"}})

    assert response.status_code == 422


def test_a_retailer_read_from_outlet_headings_blocks_approval_naming_them(monkeypatch):
    _stub_storage(monkeypatch)
    envelope = {**V2_ENVELOPE, "raw_columns": ["SKU No.", "Month", "BEDOK", "ONLINE"]}
    _serve_pending(monkeypatch, envelope)
    group = {
        "id": "outlets", "select": {"kind": "between", "after": "Month"}, "key": {"target": "retailer"},
        "value_target": "quantity_units", "confidence": "high", "reviewed": True,
    }
    locked = lambda target, field, **extra: {
        "targetField": target, "sourceColumn": "", "sourceColumns": [], "editable": False,
        "confidence": "high", "reviewed": True, "field": field, **extra,
    }
    rules = [
        _rule("sku", "SKU No.", "high", True),
        {**_rule("period_start", "Month", "high", True), "transform": [{"type": "month_start"}]},
        locked("period_type", {"status": "constant", "value": "month"}),
        locked("quantity_units", {"status": "mapped", "melt_group": "outlets"}, meltGroup=group),
        locked("retailer", {"status": "mapped", "melt_group": "outlets"}),
    ]

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 422
    assert "BEDOK, ONLINE" in response.json()["detail"]["message"]
