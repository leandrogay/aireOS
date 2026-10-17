"""
The mapping contract: one decision per target field, validated before it is
trusted, and older contracts still readable.

What must hold: every target field is accounted for (a field the file lacks
says so, with a reason), nothing unsafe is applied silently, product
attributes always come from the SKU master, and a contract stored in the first
shape reads the same as before.
"""

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services import mapping_contract as mc

COLUMNS = [
    "SKU No.", "Article Description", "Brand", "Store Code", "Store Format", "Sales UOM",
    "SALES | Month 1 | 01-01-2026", "SALES | Month 2 | 01-02-2026",
    "Qty (in EA) | Month 1 | 01-01-2026", "Qty (in EA) | Month 2 | 01-02-2026",
]
SAMPLES = {"Store Format": ["FPON", "HYPER", "SUPER"], "Article Description": ["AIRE ADULT PANTS XL 10S", "AIRE ADULT PANTS S/M 10S"]}

SALES = {
    "id": "sales",
    "select": {"kind": "pattern", "pattern": r"^SALES \| Month \d+ \| "},
    "key": {"target": "period_start", "pattern": r"(\d{2}-\d{2}-\d{4})$", "date_format": "%d-%m-%Y"},
    "value_target": "revenue",
    "confidence": "high",
}
QTY = {**SALES, "id": "qty", "select": {"kind": "pattern", "pattern": r"^Qty \(in EA\) \| "}, "value_target": "quantity_units"}


def _contract(**fields):
    return {
        "version": 2,
        "fields": {
            "period_start": {"status": "mapped", "melt_group": "sales", "confidence": "high"},
            "period_type": {"status": "derived", "confidence": "high"},
            "retailer": {"status": "constant", "value": "fairprice_offline", "confidence": "high"},
            "sku": {"status": "mapped", "source": "SKU No.", "confidence": "high"},
            "revenue": {"status": "mapped", "melt_group": "sales", "confidence": "high"},
            "quantity_units": {"status": "mapped", "melt_group": "qty", "confidence": "high"},
            **fields,
        },
        "melt_groups": [SALES, QTY],
    }


def _validate(contract, **kwargs):
    return mc.validate_contract(contract, COLUMNS, samples=SAMPLES, **kwargs)


# ---- Every field accounted for ---------------------------------------------------

def test_every_target_field_gets_exactly_one_entry():
    contract = _validate(_contract())

    assert list(contract["fields"]) == BUSINESS_COLUMNS


def test_a_field_with_no_decision_is_not_available_with_a_reason():
    contract = _validate(_contract())

    store = contract["fields"]["store_name"]
    assert store["status"] == "not_available"
    assert store["reason"]


def test_not_available_keeps_the_reason_given():
    contract = _validate(_contract(revenue={"status": "not_available", "reason": "Quantity only."}))

    assert contract["fields"]["revenue"]["reason"] == "Quantity only."


def test_product_details_are_read_from_the_file_as_mapped():
    contract = _validate(_contract(product_name={"status": "mapped", "source": "Article Description"}))

    assert contract["fields"]["product_name"]["source"] == "Article Description"


def test_source_file_is_the_pipelines_whatever_was_proposed():
    contract = _validate(_contract(source_file={"status": "mapped", "source": "Brand"}))

    assert contract["fields"]["source_file"]["status"] == "system"
    assert any("source_file" in w for w in contract["warnings"])


def test_required_fields_left_unavailable_are_reported():
    contract = _validate(_contract(retailer={"status": "not_available", "reason": "?"}))

    assert mc.required_missing_fields(contract) == ["retailer"]


def test_a_store_is_not_required():
    contract = _validate(_contract())

    assert "store_code" not in mc.required_missing_fields(contract)
    assert mc.required_missing_fields(contract) == []


# ---- Nothing unsafe applied silently ------------------------------------------------

def test_a_source_column_not_in_the_file_is_dropped_with_a_warning():
    contract = _validate(_contract(store_name={"status": "mapped", "source": "Store Name"}))

    assert contract["fields"]["store_name"]["status"] == "not_available"
    assert any("source column not found" in w for w in contract["warnings"])


def test_an_unknown_status_is_dropped_with_a_warning():
    contract = _validate(_contract(store_code={"status": "guessed", "source": "Store Code"}))

    assert contract["fields"]["store_code"]["status"] == "not_available"
    assert any("unknown status" in w for w in contract["warnings"])


def test_an_invalid_transform_drops_the_field_instead_of_passing_the_value_through():
    proposed = _contract(store_code={
        "status": "mapped", "source": "Store Code",
        "transforms": [{"type": "regex_extract", "pattern": "no group"}],
    })

    contract = _validate(proposed)

    assert contract["fields"]["store_code"]["status"] == "not_available"
    assert any("regex needs a capture group" in w for w in contract["warnings"])


def test_a_regex_cannot_extract_only_one_side_of_a_compound_value():
    proposed = _contract(store_format={
        "status": "mapped", "source": "Article Description",
        "transforms": [{"type": "regex_extract", "pattern": r"\b(XL|L|M|S)\b", "group": 1}],
    })

    contract = _validate(proposed)

    assert contract["fields"]["store_format"]["status"] == "not_available"
    assert any("complete value" in w for w in contract["warnings"])


def test_value_map_keys_must_occur_in_the_source_column():
    proposed = _contract(retailer={
        "status": "mapped", "source": "Brand",
        "transforms": [{"type": "value_map", "values": {"FPON": "fairprice_online"}}],
    })

    contract = mc.validate_contract(proposed, COLUMNS, samples={"Brand": ["AIRE"]})

    assert contract["fields"]["retailer"]["status"] == "not_available"
    assert any("none of its value_map keys occur" in w for w in contract["warnings"])


def test_rules_need_an_op_a_value_and_an_output():
    proposed = _contract(retailer={
        "status": "mapped", "source": "Store Format",
        "transforms": [{"type": "rules", "rules": [{"op": "near", "value": "FPON", "output": "x"}]}],
    })

    contract = _validate(proposed)

    assert contract["fields"]["retailer"]["status"] == "not_available"


def test_a_valid_rules_transform_is_kept():
    rules = {"type": "rules", "rules": [{"op": "equals", "value": "FPON", "output": "fairprice_online"}], "default": "fairprice_offline"}

    contract = _validate(_contract(retailer={"status": "mapped", "source": "Store Format", "transforms": [rules]}))

    assert contract["fields"]["retailer"]["transforms"] == [{**rules, "case_sensitive": False}]


def test_a_constant_period_type_must_be_month_or_week():
    contract = _validate(_contract(period_type={"status": "constant", "value": "daily"}))

    assert contract["fields"]["period_type"]["status"] == "not_available"


def test_a_derived_field_needs_a_field_with_values():
    proposed = _contract(retailer={"status": "derived", "from_field": "store_name"})

    contract = _validate(proposed)

    assert contract["fields"]["retailer"]["status"] == "not_available"


# ---- Melt groups --------------------------------------------------------------------

def test_a_pattern_selector_picks_next_months_columns_too():
    shifted = [c.replace("01-01-2026", "01-03-2026") for c in COLUMNS]

    assert mc.resolve_selector(SALES["select"], shifted) == [
        "SALES | Month 1 | 01-03-2026", "SALES | Month 2 | 01-02-2026",
    ]


def test_a_between_selector_picks_up_an_added_outlet():
    columns = ["ItemCode", "OUTLET", "2A", "TC", "TY", "Total"]

    assert mc.resolve_selector({"kind": "between", "after": "OUTLET", "before": "Total"}, columns) == ["2A", "TC", "TY"]


def test_a_melt_group_whose_key_regex_misses_a_column_is_dropped():
    bad = {**SALES, "key": {**SALES["key"], "pattern": r"(\d{4}-\d{2}-\d{2})"}}

    contract = _validate({**_contract(), "melt_groups": [bad, QTY]})

    assert [g["id"] for g in contract["melt_groups"]] == ["qty"]
    assert contract["fields"]["revenue"]["status"] == "not_available"
    assert any("regex didn't match" in w for w in contract["warnings"])


def test_two_melt_groups_cannot_fill_the_same_measure():
    contract = _validate({**_contract(), "melt_groups": [SALES, {**QTY, "value_target": "revenue"}]})

    assert len(contract["melt_groups"]) == 1
    assert any("already filled by" in w for w in contract["warnings"])


def test_melt_groups_must_share_one_key():
    outlets = {**QTY, "select": {"kind": "columns", "columns": ["Store Code"]}, "key": {"target": "store_code"}}

    contract = _validate({**_contract(), "melt_groups": [SALES, outlets]})

    assert [g["id"] for g in contract["melt_groups"]] == ["sales"]


def test_the_period_type_is_read_from_month_headers():
    contract = _validate(_contract())

    assert contract["melt_groups"][0]["period_type"] == "month"
    assert contract["fields"]["period_type"]["status"] == "derived"


# ---- Confidence and review ----------------------------------------------------------

def test_missing_or_unrecognised_confidence_becomes_low():
    contract = _validate(_contract(store_code={"status": "mapped", "source": "Store Code", "confidence": "certain"}))

    assert contract["fields"]["store_code"]["confidence"] == "low"


def test_a_generated_contract_cannot_mark_its_own_guesses_reviewed():
    proposed = _contract(store_code={"status": "mapped", "source": "Store Code", "confidence": "low", "reviewed": True})

    assert _validate(proposed)["fields"]["store_code"]["reviewed"] is False
    assert _validate(proposed, trust_review=True)["fields"]["store_code"]["reviewed"] is True


def test_only_a_literal_true_counts_as_reviewed():
    proposed = _contract(store_code={"status": "mapped", "source": "Store Code", "confidence": "low", "reviewed": "yes"})

    assert _validate(proposed, trust_review=True)["fields"]["store_code"]["reviewed"] is False


def test_unreviewed_low_confidence_lists_only_unconfirmed_guesses():
    proposed = _contract(
        store_code={"status": "mapped", "source": "Store Code", "confidence": "low", "reviewed": True},
        store_format={"status": "mapped", "source": "Store Format", "confidence": "low"},
    )

    assert mc.unreviewed_low_confidence(_validate(proposed, trust_review=True)) == ["store_format"]


# ---- Version 1 contracts ---------------------------------------------------------

V1 = {
    "identity_mapping": {
        "SKU No.": "sku",
        "Article Description": ["product_name", "size"],
        "Store Format": ["store_format", "retailer"],
    },
    "melt_groups": [{
        "target_field": "revenue",
        "columns": ["SALES | Month 1 | 01-01-2026", "SALES | Month 2 | 01-02-2026"],
        "period_extract_regex": r"(\d{2}-\d{2}-\d{4})",
        "date_format": "%d-%m-%Y",
        "confidence": "high",
    }],
    "annotations": {"retailer": {"confidence": "medium", "rationale": "FPON is online."}},
    "transformations": {"retailer": {"type": "value_map", "values": {"FPON": "fairprice_online"}, "default": "fairprice_offline"}},
}


def test_a_column_feeding_two_fields_becomes_two_entries():
    upgraded = mc.upgrade(V1)

    assert upgraded["fields"]["store_format"]["source"] == "Store Format"
    assert upgraded["fields"]["retailer"]["source"] == "Store Format"
    assert upgraded["fields"]["retailer"]["transforms"] == [V1["transformations"]["retailer"]]
    assert upgraded["fields"]["retailer"]["confidence"] == "medium"


def test_a_v1_melt_group_becomes_a_columns_selector_and_fills_the_period():
    upgraded = mc.upgrade(V1)

    group = upgraded["melt_groups"][0]
    assert group["select"] == {"kind": "columns", "columns": V1["melt_groups"][0]["columns"]}
    assert group["period_type"] == "month"
    assert upgraded["fields"]["period_start"]["melt_group"] == "revenue"
    assert upgraded["fields"]["period_type"]["status"] == "derived"


def test_a_v1_field_claimed_twice_keeps_the_first_with_a_warning():
    upgraded = mc.upgrade({"identity_mapping": {"SKU No.": "sku", "Brand": "sku"}})

    assert upgraded["fields"]["sku"]["source"] == "SKU No."
    assert any("already filled by" in w for w in upgraded["warnings"])


def test_a_v1_contract_validates_to_version_2():
    contract = _validate(V1)

    assert contract["version"] == 2
    assert contract["fields"]["retailer"]["status"] == "mapped"
    assert contract["fields"]["product_name"]["source"] == "Article Description"
    assert contract["layout"] is None and contract["aggregate"] is None


# ---- Reviewer diff ---------------------------------------------------------------

def test_the_diff_names_only_what_the_reviewer_changed():
    before = _validate(_contract())
    after = _validate(_contract(store_code={"status": "mapped", "source": "Store Code"}))

    changes = mc.contract_diff(before, after)

    assert [change.get("field") for change in changes] == ["store_code"]
    assert changes[0]["before"]["status"] == "not_available"
    assert changes[0]["after"] == {"status": "mapped", "source": "Store Code"}


# ---- Layout and roll-up instructions ----------------------------------------------

def test_layout_instructions_record_where_the_data_sits():
    layout = {"sheet": "Supplier", "sheets": ["Cover", "Supplier"], "header_row": 7, "filled_columns": ["BusinessDate"]}

    instructions = mc.layout_instructions(layout)

    assert instructions["sheet"] == "Supplier"
    assert instructions["sheet_position"] == 2
    assert instructions["header_row"] == 7
    assert instructions["fill_down"] == ["BusinessDate"]
    assert instructions["footer_label_pattern"] == mc.FOOTER_LABEL_PATTERN


def test_a_layout_fill_down_column_not_in_the_file_is_dropped():
    proposed = {**_contract(), "layout": {"header_row": 2, "fill_down": ["SKU No.", "Nope"]}}

    contract = _validate(proposed)

    assert contract["layout"]["fill_down"] == ["SKU No."]
    assert contract["layout"]["header_row"] == 2
    assert any("fill_down" in w for w in contract["warnings"])


def test_the_monthly_roll_up_instruction_is_kept_in_full():
    contract = _validate({**_contract(), "aggregate": {"period": "month"}})

    assert contract["aggregate"] == mc.monthly_aggregate()
    assert contract["aggregate"]["by"] == list(mc.AGGREGATE_KEY)


def test_an_unknown_roll_up_period_is_dropped():
    contract = _validate({**_contract(), "aggregate": {"period": "fortnight"}})

    assert contract["aggregate"] is None
    assert any("aggregate" in w for w in contract["warnings"])


def test_a_sku_code_table_is_a_value_map_on_the_sku_field():
    table = {"type": "value_map", "values": {"0059-01-025-R": "13255045"}}
    proposed = _contract(sku={"status": "mapped", "source": "SKU No.", "transforms": [table]})

    contract = mc.validate_contract(proposed, COLUMNS, samples={"SKU No.": ["0059-01-025-R"]})

    assert contract["fields"]["sku"]["transforms"] == [{**table, "case_sensitive": False}]


# ---- Writing an amended version 1 mapping back -------------------------------------

def test_a_v1_contract_round_trips_through_version_2():
    v1 = mc.downgrade(_validate(V1, trust_review=True))

    assert set(v1["identity_mapping"]["Store Format"]) == {"store_format", "retailer"}
    assert v1["transformations"]["retailer"] == {**V1["transformations"]["retailer"], "case_sensitive": False}
    assert v1["melt_groups"][0]["columns"] == V1["melt_groups"][0]["columns"]
    assert v1["melt_groups"][0]["period_extract_regex"] == V1["melt_groups"][0]["period_extract_regex"]


def test_a_contract_needing_version_2_instructions_does_not_downgrade():
    assert mc.downgrade(_validate(_contract())) is None  # pattern selectors
    assert mc.downgrade(_validate({**V1, "aggregate": {"period": "month"}})) is None
    assert mc.downgrade(_validate({**V1, "layout": {"header_row": 7}})) is None
    constant = _validate(V1)
    constant["fields"]["store_code"] = {"status": "constant", "value": "x"}
    assert mc.downgrade(constant) is None


def test_the_version_is_told_by_the_shape():
    assert mc.is_v2(_contract())
    assert not mc.is_v2(V1)
    assert not mc.is_v2({})
