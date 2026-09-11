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


def test_contract_and_builtin_normalise_to_the_same_shape():
    builtin = mv.builtin_packet()
    proposed = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    assert set(builtin) == set(proposed)
    for rule in builtin["rules"] + proposed["rules"]:
        assert set(rule) >= {"targetField", "sourceColumn", "sourceColumns", "transform", "editable"}


def test_melt_group_becomes_one_locked_rule():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")
    revenue = next(rule for rule in packet["rules"] if rule["targetField"] == "revenue")

    # Two period columns collapse into one rule, and it cannot be repointed at
    # a single column from a dropdown.
    assert revenue["sourceColumns"] == CONTRACT["melt_groups"][0]["columns"]
    assert revenue["editable"] is False
    assert "melt 2 period columns" in revenue["transform"]


def test_editing_one_rule_leaves_melt_groups_untouched():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    rules = [dict(rule) for rule in packet["rules"]]
    for rule in rules:
        if rule["targetField"] == "brand":
            rule["sourceColumn"] = "Vendor Code"

    contract = mv.rules_to_contract(rules)

    assert contract["identity_mapping"] == {"SKU No.": "sku", "Vendor Code": "brand"}
    assert contract["melt_groups"] == CONTRACT["melt_groups"]


def test_packet_reports_unread_columns_and_missing_requirements():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    assert packet["unmapped"] == ["Vendor Code"]
    # This contract fills neither, so both must be flagged for the reviewer.
    assert set(packet["requiredMissing"]) == {"quantity_units", "period_start"}
    assert packet["warnings"] == CONTRACT["warnings"]


def test_state_drives_kind_and_confirmation():
    pending = mv.envelope_to_packet("abc123", ENVELOPE, "pending")
    confirmed = mv.envelope_to_packet("abc123", ENVELOPE, "confirmed")

    assert (pending["kind"], pending["validated"]) == ("proposed", False)
    assert (confirmed["kind"], confirmed["validated"]) == ("existing", True)
    assert confirmed["validatedAt"] == ENVELOPE["confirmed_at"]


def test_builtin_is_locked_end_to_end():
    builtin = mv.builtin_packet()

    # Every rule runs as Python in apply_existing_mapping, so repointing a
    # source in the UI would change the display and not the behaviour.
    assert builtin["editable"] is False
    assert not any(rule["editable"] for rule in builtin["rules"])
    assert builtin["requiredMissing"] == []
    assert builtin["fingerprint"] is None


def test_builtin_sample_row_is_keyed_by_target_field_not_source_column():
    # Unlike a contract's rules, several builtin fields (size, retailer,
    # period_start...) are transform outputs with no single source column --
    # the sample has to be looked up by target field, using the real output
    # of actually running the mapping, not an input cell.
    builtin = mv.builtin_packet({"size": "L", "sku": "13255045", "retailer": "fairprice_offline"})
    rules_by_field = {rule["targetField"]: rule for rule in builtin["rules"]}

    assert rules_by_field["size"]["sample"] == "L"
    assert rules_by_field["sku"]["sample"] == "13255045"
    assert rules_by_field["retailer"]["sample"] == "fairprice_offline"
    # Fields absent from the given sample row degrade to no sample, not an error.
    assert rules_by_field["brand"]["sample"] is None


def test_sample_row_attaches_an_example_value_per_rule():
    envelope = {
        **ENVELOPE,
        "sample_row": {
            "SKU No.": "13255043",
            "Brand": "AIRE",
            "SALES | Week 1 | 01-01-2026": "125.50",
        },
    }
    packet = mv.envelope_to_packet("abc123", envelope, "pending")
    rules_by_field = {rule["targetField"]: rule for rule in packet["rules"]}

    assert rules_by_field["sku"]["sample"] == "13255043"
    assert rules_by_field["brand"]["sample"] == "AIRE"
    # A melt group's sample comes from its first period column.
    assert rules_by_field["revenue"]["sample"] == "125.50"


def test_missing_sample_row_leaves_sample_absent_not_an_error():
    packet = mv.envelope_to_packet("abc123", ENVELOPE, "pending")

    assert all(rule["sample"] is None for rule in packet["rules"])
    assert all(rule["sample"] is None for rule in mv.builtin_packet()["rules"])
