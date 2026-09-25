"""
One source column filling more than one target field.

An article description reads "VEXA ADULT PANTS XL 10S" -- that one string is
the product name, the size and the pack size. Forcing a reviewer to pick one
of the three loses the other two, so a contract can point a column at several
fields and a later transform pulls each one out.

What must hold: a column may fill many fields, a field may be filled by only
one column, and the shape survives the round trip through the review screen
that a reviewer edits it in.
"""

import pandas as pd

from app.services import apply_contract
from app.services import generate_mapping as gm
from app.services import mapping_view as mv


RAW_COLUMNS = ["Article Description", "Brand", "Sales | Week 1 | 01-01-2026"]

MULTI = {
    "identity_mapping": {
        "Article Description": ["product_name", "size"],
        "Brand": "brand",
    },
    "melt_groups": [],
    "annotations": {
        "product_name": {"confidence": "high", "rationale": "The description is the name."},
        "size": {"confidence": "low", "rationale": "The size token is buried in the text."},
    },
}


# ---- Reading the contract ----------------------------------------------------

def test_a_target_may_be_a_single_field_or_a_list():
    assert gm.normalize_targets("sku") == ["sku"]
    assert gm.normalize_targets(["product_name", "size"]) == ["product_name", "size"]
    assert gm.normalize_targets(None) == []
    assert gm.normalize_targets([]) == []


def test_validation_keeps_every_field_a_column_fills():
    contract = gm.validate_contract(MULTI, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["identity_mapping"]["Article Description"] == ["product_name", "size"]
    # One field stays a plain string, so existing contracts are unchanged.
    assert contract["identity_mapping"]["Brand"] == "brand"


def test_each_field_carries_its_own_confidence():
    # The point of keying annotations by target: the same column is a sure
    # thing for the product name and a guess for the size.
    contract = gm.validate_contract(MULTI, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["annotations"]["product_name"]["confidence"] == "high"
    assert contract["annotations"]["size"]["confidence"] == "low"


def test_an_unknown_field_is_dropped_without_taking_its_siblings_with_it():
    proposed = {
        "identity_mapping": {"Article Description": ["product_name", "not_a_field"]},
        "melt_groups": [],
    }

    contract = gm.validate_contract(proposed, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["identity_mapping"]["Article Description"] == "product_name"
    assert any("not_a_field" in warning for warning in contract["warnings"])


def test_two_columns_cannot_fill_the_same_field():
    # Renaming both would produce two columns of the same name, and which one
    # survived would be luck. The second is dropped, with a warning saying so.
    proposed = {
        "identity_mapping": {"Article Description": "product_name", "Brand": "product_name"},
        "melt_groups": [],
    }

    contract = gm.validate_contract(proposed, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["identity_mapping"] == {"Article Description": "product_name"}
    assert any("already filled by" in warning for warning in contract["warnings"])


def test_a_melt_group_cannot_claim_a_field_a_column_already_fills():
    proposed = {
        "identity_mapping": {"Brand": "revenue"},
        "melt_groups": [
            {
                "target_field": "revenue",
                "columns": ["Sales | Week 1 | 01-01-2026"],
                "period_extract_regex": r"(\d{2}-\d{2}-\d{4})",
                "date_format": "%d-%m-%Y",
            }
        ],
    }

    contract = gm.validate_contract(proposed, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["melt_groups"] == []
    assert any("already filled by" in warning for warning in contract["warnings"])


# ---- The round trip a reviewer's edit makes ----------------------------------

def test_one_column_filling_two_fields_becomes_two_review_rules():
    rules = mv.contract_to_rules(MULTI)
    by_field = {rule["targetField"]: rule for rule in rules}

    assert by_field["product_name"]["sourceColumn"] == "Article Description"
    assert by_field["size"]["sourceColumn"] == "Article Description"
    assert by_field["product_name"]["confidence"] == "high"
    assert by_field["size"]["confidence"] == "low"


def test_those_two_rules_rebuild_into_one_multi_target_entry():
    rebuilt = mv.rules_to_contract(mv.contract_to_rules(MULTI))

    assert rebuilt["identity_mapping"]["Article Description"] == ["product_name", "size"]
    assert rebuilt["identity_mapping"]["Brand"] == "brand"
    assert rebuilt["annotations"]["size"]["confidence"] == "low"


def test_a_reviewer_adding_a_field_to_a_column_round_trips():
    # What the review screen does when someone maps sku_range onto a column
    # that already fills two other fields.
    rules = mv.contract_to_rules(MULTI)
    rules.append({
        "targetField": "sku_range",
        "sourceColumn": "Article Description",
        "sourceColumns": ["Article Description"],
        "transform": None,
        "status": "mapped",
        "editable": True,
        "confidence": "medium",
        "rationale": "Confirmed by the reviewer.",
    })

    rebuilt = mv.rules_to_contract(rules)
    contract = gm.validate_contract(rebuilt, RAW_COLUMNS, gm.TARGET_SCHEMA)

    assert contract["identity_mapping"]["Article Description"] == [
        "product_name",
        "size",
        "sku_range",
    ]


def test_the_same_field_twice_on_one_column_is_recorded_once():
    rules = mv.contract_to_rules(MULTI)
    rules.append(dict(rules[0]))  # a duplicate row

    rebuilt = mv.rules_to_contract(rules)

    assert rebuilt["identity_mapping"]["Article Description"] == ["product_name", "size"]


# ---- Applying it -------------------------------------------------------------

def _frame():
    return pd.DataFrame(
        {
            "Article Description": ["VEXA ADULT PANTS XL 10S", "VEXA ADULT PANTS S/M 10S"],
            "Brand": ["VEXA", "VEXA"],
            "Sales | Week 1 | 01-01-2026": ["40.75", "23.25"],
        }
    )


def test_every_field_a_column_fills_reaches_the_output():
    contract = gm.validate_contract(MULTI, RAW_COLUMNS, gm.TARGET_SCHEMA)

    result = apply_contract.apply_contract(_frame(), contract)

    assert "product_name" in result.columns
    assert "size" in result.columns
    assert "brand" in result.columns
    # The source column is gone -- it became the fields it fills.
    assert "Article Description" not in result.columns


def test_extra_fields_get_the_untransformed_value_for_now():
    # Deliberate: no transform is configured yet, so size holds the whole
    # description rather than "XL". Pinned so that building the transform is a
    # visible change to this expectation rather than a silent one.
    contract = gm.validate_contract(MULTI, RAW_COLUMNS, gm.TARGET_SCHEMA)

    result = apply_contract.apply_contract(_frame(), contract)

    assert result["product_name"].tolist() == result["size"].tolist()
    assert result["size"].iloc[0] == "VEXA ADULT PANTS XL 10S"


def test_multi_target_survives_a_melt():
    contract = gm.validate_contract(
        {
            "identity_mapping": {"Article Description": ["product_name", "size"]},
            "melt_groups": [
                {
                    "target_field": "revenue",
                    "columns": ["Sales | Week 1 | 01-01-2026"],
                    "period_extract_regex": r"(\d{2}-\d{2}-\d{4})",
                    "date_format": "%d-%m-%Y",
                }
            ],
        },
        RAW_COLUMNS,
        gm.TARGET_SCHEMA,
    )

    result = apply_contract.apply_contract(_frame(), contract)

    assert {"product_name", "size", "revenue", "period_start"} <= set(result.columns)
    assert result["size"].tolist() == result["product_name"].tolist()


def test_a_single_target_contract_applies_exactly_as_before():
    contract = gm.validate_contract(
        {"identity_mapping": {"Brand": "brand"}, "melt_groups": []},
        RAW_COLUMNS,
        gm.TARGET_SCHEMA,
    )

    result = apply_contract.apply_contract(_frame(), contract)

    assert result["brand"].tolist() == ["VEXA", "VEXA"]
    assert "Brand" not in result.columns
