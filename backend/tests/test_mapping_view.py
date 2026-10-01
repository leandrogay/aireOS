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
    # Nothing fills quantity_units, so the reviewer must be told.
    assert packet["requiredMissing"] == ["quantity_units"]
    assert packet["warnings"] == CONTRACT["warnings"]


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


def test_builtin_is_locked_end_to_end():
    builtin = mv.builtin_packet()

    # Every rule runs as Python in apply_existing_mapping, so repointing a
    # source in the UI would change the display and not the behaviour.
    assert builtin["editable"] is False
    assert not any(rule["editable"] for rule in builtin["rules"])
    assert builtin["requiredMissing"] == []
    assert builtin["fingerprint"] is None
