from app.services import mapping_contract, mapping_view as mv
from app.services.reference_contracts import SINGHEALTH_ER130


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


SINGHEALTH_COLUMNS = ["Product Code", "Product Name", "Vendor code", "Vendor Name", "Normal cost", "Promo cost", "BEDOK", "ONLINE"]


def test_store_codes_above_the_header_and_a_stated_period_survive_review():
    packet = mv.envelope_to_packet("sh", {"contract": SINGHEALTH_ER130, "raw_columns": SINGHEALTH_COLUMNS}, "pending")
    by_field = {rule["targetField"]: rule for rule in packet["rules"]}

    contract = mapping_contract.validate_contract(mv.rules_to_contract(packet["rules"]), SINGHEALTH_COLUMNS, trust_review=True)

    assert contract["warnings"] == []
    assert contract["melt_groups"][0]["labels"] == [{"rows_above": 1, "target": "store_code"}]
    assert contract["fields"]["period_start"]["from_layout"] == "stated_period"
    assert contract["fields"]["revenue"]["transforms"] == [{"type": "multiply", "column": "Promo cost"}]
    assert by_field["store_code"]["description"].startswith("Read from the cells above the column headers")
    assert by_field["period_start"]["description"] == "The month the file's title states"


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


# ---- Column groups the reviewer can choose -------------------------------------

V2_COLUMNS = [
    "SKU No.",
    "SALES | Month 1 | 01-01-2026",
    "SALES | Month 2 | 01-02-2026",
    "Qty | Month 1 | 01-01-2026",
    "Qty | Month 2 | 01-02-2026",
]
SALES_GROUP = {
    "id": "sales",
    "select": {"kind": "pattern", "pattern": r"^SALES \| Month \d+ \| "},
    "key": {"target": "period_start", "pattern": r"(\d{2}-\d{2}-\d{4})$", "date_format": "%d-%m-%Y"},
    "value_target": "revenue",
    "period_type": "month",
}


def test_column_groups_say_which_measure_each_fills_and_how_its_headings_read():
    contract = {"version": 2, "fields": {}, "melt_groups": [SALES_GROUP]}

    groups = mv.column_groups(V2_COLUMNS, contract, {"Qty | Month 1 | 01-01-2026": ["4"]})

    sales, qty = groups
    assert (sales["meltGroupId"], sales["field"]) == ("sales", "revenue")
    # A group the contract already has keeps the contract's own settings.
    assert sales["group"]["select"] == SALES_GROUP["select"]
    assert (qty["meltGroupId"], qty["field"]) == (None, None)
    assert qty["readings"][0] == {"column": "Qty | Month 1 | 01-01-2026", "readsAs": "2026-01-01", "sample": "4"}
    assert (qty["first"], qty["last"]) == ("2026-01-01", "2026-02-01")
    assert qty["label"] == "Qty | Month 1 | ‹period›"


def test_weekly_spaced_headings_read_as_weeks():
    columns = ["Sales 05-01-2026", "Sales 12-01-2026", "Sales 19-01-2026"]

    (group,) = mv.column_groups(columns, {"version": 2, "fields": {}, "melt_groups": []}, {})

    assert group["group"]["period_type"] == "week"


def test_a_group_built_from_a_detected_one_validates_as_a_melt_group():
    # The rules the review screen sends when a reviewer picks a detected group
    # for Units sold: the group's settings, an id, the field it fills.
    contract = {"version": 2, "fields": {}, "melt_groups": [SALES_GROUP]}
    qty = mv.column_groups(V2_COLUMNS, contract, {})[1]
    group = {**qty["group"], "id": "quantity_units", "value_target": "quantity_units"}
    rules = [
        {
            "targetField": "quantity_units",
            "editable": False,
            "confidence": "high",
            "reviewed": True,
            "meltGroup": group,
            "field": {"status": "mapped", "melt_group": "quantity_units"},
        },
        {
            "targetField": "period_start",
            "editable": False,
            "confidence": "high",
            "reviewed": True,
            "field": {"status": "mapped", "melt_group": "quantity_units"},
        },
    ]

    validated = mv.validate_contract(mv.rules_to_contract(rules), V2_COLUMNS, trust_review=True)

    assert validated["fields"]["quantity_units"]["melt_group"] == "quantity_units"
    assert validated["fields"]["period_start"]["melt_group"] == "quantity_units"
    assert [g["id"] for g in validated["melt_groups"]] == ["quantity_units"]
    assert not [w for w in validated["warnings"] if "melt group" in w.lower()]


def test_a_month_named_group_offered_to_the_reviewer_runs_as_months():
    import pandas as pd

    from app.services import apply_contract

    columns = ["Article", "Net Sales Jan 2026", "Net Sales Feb 2026"]
    (entry,) = mv.column_groups(columns, {"version": 2, "fields": {}, "melt_groups": []}, {})
    group = {**entry["group"], "id": "revenue", "value_target": "revenue", "confidence": "high"}
    contract = mv.validate_contract(
        {
            "version": 2,
            "melt_groups": [group],
            "fields": {
                "revenue": {"status": "mapped", "melt_group": "revenue"},
                "period_start": {"status": "mapped", "melt_group": "revenue"},
                "period_type": {"status": "derived"},
                "sku": {"status": "mapped", "source": "Article"},
                "retailer": {"status": "constant", "value": "giant_offline"},
            },
        },
        columns,
    )

    out = apply_contract.apply_contract(pd.DataFrame([["13255043", 5, 7]], columns=columns), contract, source_file="x")

    assert out["period_start"].astype(str).tolist() == ["2026-01-01", "2026-02-01"]
    assert out["revenue"].tolist() == [5, 7]
    assert set(out["period_type"]) == {"month"}


def test_the_packet_says_which_model_proposed_the_mapping():
    packet = mv.envelope_to_packet("fp", {**ENVELOPE, "provider": "gemini", "model": "gemini-3.8-flash"}, "pending")

    assert packet["proposedBy"] == {"provider": "gemini", "model": "gemini-3.8-flash"}
    # A mapping written before this was recorded has no model to name.
    assert mv.envelope_to_packet("fp", ENVELOPE, "pending")["proposedBy"] == {"provider": None, "model": None}
