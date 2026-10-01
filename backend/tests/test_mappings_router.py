"""
Status-code mapping for POST /api/mappings/{fingerprint}/confirm.

The review screen blocks approval while a low-confidence field is unconfirmed,
but the endpoint is the last gate before a contract is reused for every future
file with these headers, so it holds the same line itself.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.services import storage

client = TestClient(app)

ENVELOPE = {
    "raw_columns": ["SKU No.", "Brand"],
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

def test_confirm_rejects_an_unreviewed_low_confidence_field_with_422(monkeypatch):
    stored = _stub_storage(monkeypatch)
    rules = [
        _rule("sku", "SKU No.", "high", False),
        _rule("brand", "Brand", "low", False),
    ]

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 422
    assert "brand" in response.json()["detail"]["message"]
    assert "envelope" not in stored


def test_confirm_stores_a_reviewed_low_confidence_field_as_reviewed(monkeypatch):
    stored = _stub_storage(monkeypatch)
    rules = [
        _rule("sku", "SKU No.", "high", False),
        _rule("brand", "Brand", "low", True),
    ]

    response = client.post("/api/mappings/fp/confirm", json={"rules": rules})

    assert response.status_code == 200
    brand = stored["envelope"]["contract"]["annotations"]["brand"]
    assert brand == {"confidence": "low", "rationale": "", "reviewed": True}


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
    rules = [_rule("sku", "SKU No.", "high", False)]

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
