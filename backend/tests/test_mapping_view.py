from app.services import mapping_view as mv


CONTRACT = {
    "identity_mapping": {"SKU No.": "sku", "Brand": "brand"},
    "melt_groups": [
        {
            "target_field": "revenue",
            "columns": ["SALES | Week 1 | 01-01-2026", "SALES | Week 2 | 08-01-2026"],
            "period_extract_regex": r"(\d{2}-\d{2}-\d{4})",
            "date_format": "%d-%m-%Y",
        }
    ],
    "warnings": ["1 column(s) left unmapped: ['Vendor Code']"],
}

ENVELOPE = {
    "contract": CONTRACT,
    "raw_columns": [
        "SKU No.",
        "Brand",
        "Vendor Code",
        "SALES | Week 1 | 01-01-2026",
        "SALES | Week 2 | 08-01-2026",
    ],
    "example_file": "uploads/week.txt",
    "confirmed_at": "2026-08-27T00:00:00+00:00",
}


def test_stored_contract_normalises_to_review_rules():
    proposed = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    for rule in proposed["rules"]:
        assert set(rule) >= {"targetField", "sourceColumn", "sourceColumns", "transform", "editable"}


def test_melt_group_becomes_one_locked_rule():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")
    revenue = next(rule for rule in packet["rules"] if rule["targetField"] == "revenue")

    # Two period columns collapse into one rule, and it cannot be repointed at
    # a single column from a dropdown.
    assert revenue["sourceColumns"] == CONTRACT["melt_groups"][0]["columns"]
    assert revenue["editable"] is False
    assert "melt 2 period columns" in revenue["transform"]


def test_every_target_field_has_a_rule():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    assert [rule["targetField"] for rule in packet["rules"]] == mv.CORE_TARGET_FIELDS


def test_a_field_without_a_column_says_how_it_is_filled():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")
    by_field = {rule["targetField"]: rule for rule in packet["rules"]}

    assert by_field["period_end"]["status"] == "derived"
    assert by_field["period_end"]["description"] == "Computed"
    assert by_field["store_name"]["status"] == "not_available"
    assert by_field["store_name"]["description"].startswith("Not in this file")


def test_a_reviewer_assigning_a_column_overrides_not_available():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")
    rules = packet["rules"] + [{
        "targetField": "store_name", "sourceColumn": "Vendor Code",
        "sourceColumns": ["Vendor Code"], "editable": True, "confidence": "high", "reviewed": True,
    }]

    contract = mv.rules_to_contract(rules)

    assert contract["fields"]["store_name"]["status"] == "mapped"
    assert contract["fields"]["store_name"]["source"] == "Vendor Code"


def test_an_edited_sku_code_table_rides_along_on_its_rule():
    table = {"type": "value_map", "values": {"0059-01-025-R": "13255045"}}
    rules = [{"targetField": "sku", "sourceColumn": "Material", "editable": True, "transform": [table]}]

    contract = mv.rules_to_contract(rules)

    assert contract["fields"]["sku"]["transforms"] == [table]


def test_the_packet_carries_the_code_table_and_the_instructions():
    envelope = {
        **ENVELOPE,
        "sku_codes": [{"code": "0059-01-025-R", "sku": "13255045", "description": "PANTS L", "rows": 3}],
        "contract": {"version": 2, "fields": {}, "melt_groups": [], "aggregate": {"period": "month"}},
    }

    packet = mv.envelope_to_packet("abc123", envelope, "pending")

    assert packet["skuCodes"] == envelope["sku_codes"]
    assert packet["instructions"]["aggregate"]["period"] == "month"
    assert packet["contractFormat"] == 2
    assert mv.envelope_to_packet("abc123", ENVELOPE, "pending")["contractFormat"] == 1


def test_editing_one_rule_leaves_melt_groups_untouched():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    rules = [dict(rule) for rule in packet["rules"]]
    for rule in rules:
        if rule["targetField"] == "sku":
            rule["sourceColumn"] = "Vendor Code"

    contract = mv.rules_to_contract(rules)

    assert contract["fields"]["sku"]["source"] == "Vendor Code"
    group = contract["melt_groups"][0]
    assert group["select"] == {"kind": "columns", "columns": CONTRACT["melt_groups"][0]["columns"]}
    assert group["key"]["pattern"] == CONTRACT["melt_groups"][0]["period_extract_regex"]


def test_packet_reports_unread_columns_and_missing_requirements():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    assert packet["unmapped"] == ["Vendor Code"]
    # A row cannot exist without these. A store is not one of them: a
    # retailer that reports none loads under a placeholder store.
    assert packet["requiredMissing"] == ["retailer", "quantity_units"]


# ---- Period fields -----------------------------------------------------------

def test_a_melt_group_fills_the_period_fields():
    # apply_contract reads period_start out of each period column's header, so
    # no rule names it -- it must not be reported missing.
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "confirmed")

    assert "period_start" not in packet["requiredMissing"]


def test_without_a_melt_group_period_start_is_missing():
    envelope = {**ENVELOPE, "contract": {**CONTRACT, "melt_groups": []}}

    packet = mv.envelope_to_packet("abc123", envelope, "confirmed")

    assert "period_start" in packet["requiredMissing"]


def test_state_drives_kind_and_confirmation():
    pending = mv.envelope_to_packet("abc123", ENVELOPE, "pending")
    confirmed = mv.envelope_to_packet("abc123", ENVELOPE, "confirmed")

    assert (pending["kind"], pending["validated"]) == ("proposed", False)
    assert (confirmed["kind"], confirmed["validated"]) == ("existing", True)
    assert confirmed["validatedAt"] == ENVELOPE["confirmed_at"]
