"""
Confidence, rationale and near-miss layout matching.

These exist to keep one promise the review screen makes: a row is only
presented as certain when the proposal actually said it was, and a layout is
only applied without a human when it is exactly a layout someone approved.
"""

from app.services import generate_mapping as gm
from app.services import mapping_view as mv


RAW_COLUMNS = ["SKU No.", "Brand", "Sales | Week 1 | 01-01-2026"]

CONTRACT = {
    "identity_mapping": {"SKU No.": "sku", "Brand": "brand"},
    "melt_groups": [
        {
            "target_field": "revenue",
            "columns": ["Sales | Week 1 | 01-01-2026"],
            "period_extract_regex": r"(\d{2}-\d{2}-\d{4})",
            "date_format": "%d-%m-%Y",
            "confidence": "high",
            "rationale": "Every column in the group carries a week date.",
        }
    ],
    # Keyed by target field: one column can feed two fields and be a sure
    # thing for one of them and a guess for the other.
    "annotations": {
        "sku": {"confidence": "high", "rationale": "Values are 8-digit article numbers."},
        "brand": {"confidence": "medium", "rationale": "Could also be the vendor name."},
    },
}


# ---- Confidence normalisation -------------------------------------------------

def test_validated_contract_keeps_confidence_and_rationale():
    contract = gm.validate_contract(CONTRACT, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["annotations"]["sku"]["confidence"] == "high"
    assert contract["annotations"]["brand"]["confidence"] == "medium"
    assert contract["melt_groups"][0]["confidence"] == "high"
    assert "week date" in contract["melt_groups"][0]["rationale"]


def test_missing_or_unrecognised_confidence_becomes_low():
    # An absent annotation, a misspelling and an invented level all have to
    # land in the bucket that forces a human to look, never the one that waves
    # the row through.
    proposed = {
        "identity_mapping": {"SKU No.": "sku", "Brand": "brand"},
        "melt_groups": [],
        "annotations": {"brand": {"confidence": "very sure", "rationale": "  "}},
    }

    contract = gm.validate_contract(proposed, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["annotations"]["sku"]["confidence"] == "low"
    assert contract["annotations"]["brand"]["confidence"] == "low"
    assert contract["annotations"]["brand"]["rationale"] == ""


def test_annotations_for_dropped_columns_are_dropped_too():
    proposed = {
        "identity_mapping": {"Nonexistent": "sku"},
        "melt_groups": [],
        "annotations": {"Nonexistent": {"confidence": "high", "rationale": "x"}},
    }

    contract = gm.validate_contract(proposed, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["annotations"] == {}


# ---- Round trip through the review shape --------------------------------------

def test_confidence_survives_the_trip_to_rules_and_back():
    rules = mv.contract_to_rules(CONTRACT)
    by_field = {rule["targetField"]: rule for rule in rules}

    assert by_field["sku"]["confidence"] == "high"
    assert by_field["brand"]["confidence"] == "medium"
    assert by_field["revenue"]["confidence"] == "high"

    # rules_to_contract runs on approval, so anything it loses is lost for good.
    for rule in rules:
        if not rule["editable"]:
            rule["meltGroup"] = CONTRACT["melt_groups"][0]

    rebuilt = mv.rules_to_contract(rules)

    assert rebuilt["annotations"]["brand"]["confidence"] == "medium"
    assert rebuilt["annotations"]["brand"]["rationale"] == "Could also be the vendor name."


def test_contract_stored_before_confidence_existed_reads_as_low():
    legacy = {"identity_mapping": {"SKU No.": "sku"}, "melt_groups": []}

    rule = mv.contract_to_rules(legacy)[0]

    assert rule["confidence"] == "low"
    assert rule["rationale"] == ""


# ---- Near-miss layouts ---------------------------------------------------------

def _stub_confirmed(monkeypatch, envelopes):
    """Point the partial-match scan at in-memory envelopes instead of GCS."""
    monkeypatch.setattr(
        gm.storage, "list_mapping_fingerprints", lambda state: list(envelopes)
    )
    monkeypatch.setattr(
        gm.storage,
        "download_json",
        lambda path: envelopes[path.rsplit("/", 1)[-1].removesuffix(".json")],
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
