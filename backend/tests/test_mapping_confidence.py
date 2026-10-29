"""
Confidence on the review screen, and near-miss layout matching.

These exist to keep one promise the review screen makes: a row is only
presented as certain when the proposal actually said it was, and a layout is
only applied without a human when it is a layout someone approved.
"""

from app.services import generate_mapping as gm
from app.services import mapping_view as mv

RAW_COLUMNS = ["SKU No.", "Store Code", "Sales | Week 1 | 01-01-2026"]

CONTRACT = {
    "version": 2,
    "fields": {
        "sku": {"status": "mapped", "source": "SKU No.", "confidence": "high", "rationale": "8-digit article numbers."},
        "store_code": {"status": "mapped", "source": "Store Code", "confidence": "medium", "rationale": "Could be a region."},
        "revenue": {"status": "mapped", "melt_group": "sales", "confidence": "high"},
        "period_start": {"status": "mapped", "melt_group": "sales", "confidence": "high"},
        "period_type": {"status": "derived", "confidence": "high"},
    },
    "melt_groups": [{
        "id": "sales",
        "select": {"kind": "pattern", "pattern": r"^Sales \| Week"},
        "key": {"target": "period_start", "pattern": r"(\d{2}-\d{2}-\d{4})", "date_format": "%d-%m-%Y"},
        "value_target": "revenue",
        "confidence": "high",
        "rationale": "Every column in the group carries a week date.",
    }],
}


def _rules(contract=CONTRACT, **kwargs):
    validated = gm.validate_contract(contract, RAW_COLUMNS, gm.TARGET_SCHEMA, **kwargs)
    return {rule["targetField"]: rule for rule in mv.contract_to_rules(validated, columns=RAW_COLUMNS)}


# ---- Confidence on the review rules -----------------------------------------------

def test_confidence_and_rationale_survive_validation_into_the_rules():
    rules = _rules()

    assert rules["sku"]["confidence"] == "high"
    assert rules["store_code"]["confidence"] == "medium"
    assert rules["store_code"]["rationale"] == "Could be a region."
    assert rules["revenue"]["confidence"] == "high"


def test_confidence_survives_the_trip_to_rules_and_back():
    rebuilt = mv.rules_to_contract(list(_rules().values()))

    assert rebuilt["fields"]["store_code"]["confidence"] == "medium"
    assert rebuilt["melt_groups"][0]["confidence"] == "high"


def test_the_reviewed_flag_round_trips_through_rules_and_contract():
    rules = _rules()
    rules["store_code"]["reviewed"] = True

    rebuilt = mv.rules_to_contract(list(rules.values()))
    contract = gm.validate_contract(rebuilt, RAW_COLUMNS, gm.TARGET_SCHEMA, trust_review=True)

    assert contract["fields"]["store_code"]["reviewed"] is True


def test_a_contract_stored_before_confidence_existed_reads_as_low():
    legacy = {"identity_mapping": {"SKU No.": "sku"}, "melt_groups": []}

    rules = {rule["targetField"]: rule for rule in mv.contract_to_rules(legacy)}

    assert rules["sku"]["confidence"] == "low"


def test_a_mapping_approved_before_the_flag_existed_reads_as_reviewed():
    legacy = {
        "identity_mapping": {"Store Code": "store_code"},
        "melt_groups": [],
        "annotations": {"store_code": {"confidence": "low", "rationale": ""}},
    }
    envelope = {"contract": legacy, "raw_columns": ["Store Code"]}

    confirmed = mv.envelope_to_packet("fp", envelope, "confirmed")
    pending = mv.envelope_to_packet("fp", envelope, "pending")

    def store(packet):
        return next(rule for rule in packet["rules"] if rule["targetField"] == "store_code")

    assert store(confirmed)["reviewed"] is True
    assert store(pending)["reviewed"] is False


# ---- Near-miss layouts ---------------------------------------------------------

def _stub_confirmed(monkeypatch, envelopes):
    """Point the partial-match scan at in-memory envelopes instead of GCS."""
    monkeypatch.setattr(gm.storage, "list_mapping_fingerprints", lambda state: list(envelopes))
    monkeypatch.setattr(
        gm.storage,
        "download_json",
        lambda path: envelopes.get(path.rsplit("/", 1)[-1].removesuffix(".json")),
    )


def test_one_added_column_is_a_partial_match_not_a_new_layout(monkeypatch):
    stored = ["SKU No.", "Brand", "Store Code", "Store Name", "Revenue"]
    _stub_confirmed(monkeypatch, {
        "storedfp": {"raw_columns": stored, "name": "Vendor weekly", "vendor": "XEL"},
    })

    match = gm.find_partial_match(stored + ["Promo Flag"])

    assert match["fingerprint"] == "storedfp"
    assert match["name"] == "Vendor weekly"
    assert match["extra_columns"] == ["Promo Flag"]
    assert match["missing_columns"] == []
    assert 0.8 < match["match_ratio"] < 1.0


def test_a_dropped_column_is_reported_as_missing(monkeypatch):
    stored = ["SKU No.", "Brand", "Store Code", "Store Name", "Revenue"]
    _stub_confirmed(monkeypatch, {"storedfp": {"raw_columns": stored}})

    match = gm.find_partial_match(stored[:-1])

    assert match["missing_columns"] == ["Revenue"]
    assert match["extra_columns"] == []


def test_an_unrelated_layout_does_not_match(monkeypatch):
    _stub_confirmed(monkeypatch, {
        "storedfp": {"raw_columns": ["SKU No.", "Brand", "Store Code", "Revenue"]},
    })

    assert gm.find_partial_match(["Date", "Customer", "Order Total"]) is None


def test_the_closest_of_several_stored_layouts_wins(monkeypatch):
    base = ["SKU No.", "Brand", "Store Code", "Store Name", "Revenue"]
    _stub_confirmed(monkeypatch, {
        "near": {"raw_columns": base},
        "far": {"raw_columns": base[:3] + ["Something", "Else", "Entirely"]},
    })

    assert gm.find_partial_match(base + ["Promo Flag"])["fingerprint"] == "near"


def test_matching_ignores_column_order_and_punctuation(monkeypatch):
    # The same normalisation the fingerprint uses, so the two paths cannot
    # disagree about what "the same column" means.
    _stub_confirmed(monkeypatch, {
        "storedfp": {"raw_columns": ["SKU No.", "Brand", "Store Code", "Revenue"]},
    })

    match = gm.find_partial_match(["revenue", "store code", "brand", "SKU_No", "Extra"])

    assert match is not None
    assert match["missing_columns"] == []


def test_other_months_in_the_headers_are_not_a_difference(monkeypatch):
    stored = ["SKU No.", "SALES | Month 1 | 01-01-2026", "SALES | Month 2 | 01-02-2026"]
    _stub_confirmed(monkeypatch, {gm.fingerprint(stored): {"raw_columns": stored, "contract": CONTRACT}})
    shifted = ["SKU No.", "SALES | Month 1 | 01-03-2026", "SALES | Month 2 | 01-04-2026"]

    key, envelope = gm.find_confirmed(shifted)

    assert key == gm.fingerprint(stored)
    assert envelope["contract"] == CONTRACT
