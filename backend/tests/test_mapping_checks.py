"""
Static checks of a contract against the file it was made from.

Nothing here runs the contract. Each check is pinned by a contract it must
catch: a product code that is not a master SKU, revenue read from a claim
column, sales left negative, a period outside the one the file states. The
reference contracts must pass them all.
"""

import pytest
from conftest import fairprice_txt, nhg_xlsx, sheng_siong_xlsx, singhealth_xlsx

from app.services import layout_detection, mapping_checks as mk, mapping_contract, reference_contracts

MASTER = {"13255043", "13255044", "13255045", "13271337", "13271338", "13271339", "13271340", "13271341", "13271342"}


def _run(name, filename, data, contract=None, master=MASTER):
    frame, layout = layout_detection.read_table(filename, data)
    contract = contract or reference_contracts.reference_contract(name)
    contract["layout"] = mapping_contract.layout_instructions(layout)
    validated = mapping_contract.validate_contract(contract, list(frame.columns), trust_review=True)
    return mk.run_checks(frame, layout, validated, filename, master), validated, frame


def _by_id(checks):
    return {check["id"]: check for check in checks}


@pytest.mark.parametrize("name", ["fairprice_monthly", "nhg_sap", "sheng_siong_claim", "singhealth_er130", "prime_jkdc"])
def test_the_reference_contracts_pass_every_check(name, retailer_files):
    filename, data = retailer_files[name]

    checks, _, _ = _run(name, filename, data)

    assert mk.failures(checks) == []


# ---- Product codes ----------------------------------------------------------------

def test_a_code_missing_from_the_code_table_fails_with_the_code_named():
    checks, _, _ = _run("nhg_sap", "nhg.xlsx", nhg_xlsx(extra_material="0059-01-099-R"))

    skus = _by_id(checks)["sku_codes"]
    assert skus["passed"] is False
    assert [item["code"] for item in skus["evidence"]["unknown"]] == ["0059-01-099-R"]
    assert "0059-01-099-R" in skus["message"]


def test_a_code_table_entry_pointing_outside_the_master_fails():
    contract = reference_contracts.reference_contract("nhg_sap")
    contract["fields"]["sku"]["transforms"][0]["values"]["0059-01-025-R"] = "99999999"

    checks, _, _ = _run("nhg_sap", "nhg.xlsx", nhg_xlsx(), contract)

    unknown = _by_id(checks)["sku_codes"]["evidence"]["unknown"]
    assert unknown == [{"code": "0059-01-025-R", "reads_as": "99999999", "description": "AIRE ADULT PULL UP PANTS L 10S", "rows": 3}]


def test_codes_without_a_code_table_must_themselves_be_master_skus():
    checks, _, _ = _run("fairprice_monthly", "fp.txt", fairprice_txt(), master={"13255043"})

    assert [i["code"] for i in _by_id(checks)["sku_codes"]["evidence"]["unknown"]] == ["13255044"]


def test_an_unreadable_sku_master_fails_the_product_code_check():
    checks, _, _ = _run("nhg_sap", "nhg.xlsx", nhg_xlsx(), master=None)

    assert _by_id(checks)["sku_codes"]["passed"] is False
    assert "could not be read" in _by_id(checks)["sku_codes"]["message"]


def test_sku_codes_lists_each_code_with_its_description_and_rows():
    _, contract, frame = _run("nhg_sap", "nhg.xlsx", nhg_xlsx())

    assert mk.sku_codes(frame, contract) == [
        {"code": "0059-01-025-R", "sku": "13255045", "description": "AIRE ADULT PULL UP PANTS L 10S", "rows": 3},
        {"code": "0059-01-027-R", "sku": "13255043", "description": "AIRE ADULT PULL UP PANTS XL 10S", "rows": 1},
    ]


# ---- Other checks -------------------------------------------------------------------

def test_revenue_from_the_supplier_claim_column_is_an_error():
    contract = reference_contracts.reference_contract("sheng_siong_claim")
    contract["fields"]["revenue"] = {"status": "mapped", "source": "Supplier Claim"}

    checks, _, _ = _run("sheng_siong_claim", "ss.xlsx", sheng_siong_xlsx(), contract)

    revenue = _by_id(checks)["revenue_source"]
    assert revenue["passed"] is False
    assert revenue["fields"] == ["revenue"]


def test_mostly_negative_quantities_without_negate_are_flagged():
    contract = reference_contracts.reference_contract("nhg_sap")
    contract["fields"]["quantity_units"].pop("transforms")

    checks, _, _ = _run("nhg_sap", "nhg.xlsx", nhg_xlsx(), contract)

    sign = _by_id(checks)["quantity_sign"]
    assert (sign["level"], sign["passed"]) == ("warning", False)


def test_periods_outside_the_stated_period_are_an_error():
    checks, _, _ = _run("nhg_sap", "Aire Sell Out Jul 26.xlsx", nhg_xlsx())

    period = _by_id(checks)["period"]
    assert period["passed"] is False
    assert period["evidence"]["outside"] == ["2026-08"]


def test_period_headers_are_checked_against_the_filename_range():
    checks, _, _ = _run("fairprice_monthly", "XEL_VENDORS_BRANDS_MONTH_01-03-2026_01-04-2026_1.txt", fairprice_txt())

    assert _by_id(checks)["period"]["evidence"]["outside"] == ["2026-01", "2026-02"]


def test_a_required_field_marked_not_available_fails():
    contract = reference_contracts.reference_contract("nhg_sap")
    contract["fields"]["retailer"] = {"status": "not_available", "reason": "?"}

    checks, _, _ = _run("nhg_sap", "nhg.xlsx", nhg_xlsx(), contract)

    assert _by_id(checks)["required_retailer"]["passed"] is False


def test_values_falling_to_a_rules_default_are_listed():
    checks, _, _ = _run("fairprice_monthly", "fp.txt", fairprice_txt())

    rules = _by_id(checks)["rules_retailer"]
    assert rules["evidence"]["matched"] == ["FPON"]
    assert rules["evidence"]["default"] == ["SUPER"]


def test_a_rule_without_a_default_must_cover_every_value():
    contract = reference_contracts.reference_contract("fairprice_monthly")
    contract["fields"]["retailer"]["transforms"][0].pop("default")

    checks, _, _ = _run("fairprice_monthly", "fp.txt", fairprice_txt(), contract)

    rules = _by_id(checks)["rules_retailer"]
    assert rules["passed"] is False
    assert "SUPER" in rules["message"]


def test_outlet_codes_are_the_inputs_of_a_rule_derived_from_the_store():
    checks, _, _ = _run("sheng_siong_claim", "ss.xlsx", sheng_siong_xlsx())

    rules = _by_id(checks)["rules_retailer"]
    assert rules["evidence"]["matched"] == ["6M_Ecomm"]
    assert rules["evidence"]["default"] == ["2A", "TC"]


def test_revenue_as_units_times_a_unit_cost_passes_the_revenue_check():
    checks, _, _ = _run("singhealth_er130", "XEL.xlsx", singhealth_xlsx())

    assert _by_id(checks)["revenue_source"]["passed"] is True


def test_revenue_as_units_times_a_claim_per_unit_is_an_error():
    contract = reference_contracts.reference_contract("sheng_siong_claim")
    contract["fields"]["revenue"] = {
        "status": "derived", "from_field": "quantity_units",
        "transforms": [{"type": "multiply", "column": "Supplier Claim"}],
    }

    checks, _, _ = _run("sheng_siong_claim", "ss.xlsx", sheng_siong_xlsx(), contract)

    revenue = _by_id(checks)["revenue_source"]
    assert revenue["passed"] is False
    assert revenue["evidence"]["columns"] == ["Supplier Claim"]


def test_outlet_names_in_the_headers_are_the_inputs_of_a_rule_derived_from_them():
    checks, _, _ = _run("singhealth_er130", "XEL.xlsx", singhealth_xlsx())

    rules = _by_id(checks)["rules_retailer"]
    assert rules["evidence"]["matched"] == ["ONLINE"]
    assert rules["evidence"]["default"] == ["BEDOK"]


def test_store_codes_read_from_above_the_header_are_checked_for_every_outlet():
    checks, _, _ = _run("singhealth_er130", "XEL.xlsx", singhealth_xlsx(outlets=[("81001", "BEDOK"), ("", "NEWSTORE")]))

    labels = _by_id(checks)["labels_store_code"]
    assert labels["passed"] is False
    assert labels["evidence"]["missing"] == ["NEWSTORE"]


def test_a_period_read_from_the_title_needs_a_title_stating_one_month():
    checks, _, _ = _run("singhealth_er130", "XEL.xlsx", singhealth_xlsx(period="01 Jul 2026 TO 31 Aug 2026"))

    assert _by_id(checks)["period"]["passed"] is False


def test_a_period_read_from_the_title_fails_when_the_file_states_none():
    checks, _, _ = _run("singhealth_er130", "XEL.xlsx", singhealth_xlsx(period="(no period)"))

    period = _by_id(checks)["period"]
    assert period["passed"] is False
    assert "states no period" in period["message"]


def test_the_instructions_are_stated_in_words():
    checks, _, _ = _run("sheng_siong_claim", "ss.xlsx", sheng_siong_xlsx())

    message = _by_id(checks)["instructions"]["message"]
    assert "header row 7" in message and "fill down BusinessDate" in message and "each month" in message


# ---- The period a file states ---------------------------------------------------------

def test_the_stated_period_comes_from_a_fairprice_filename_range():
    stated = mk.stated_period({}, "XEL_VENDORS_BRANDS_MONTH_01-01-2026_01-08-2026_1.txt")

    assert (stated["start"], stated["end"]) == ("2026-01-01", "2026-08-01")


def test_a_creation_date_in_a_filename_is_not_a_period():
    assert mk.stated_period({}, "Claim_Sales_Summary_Report_XLPL_CSTANG_P100045355_03JUL26.xlsx") is None


# ---- Confidence from checks --------------------------------------------------------------

def test_a_failed_check_lowers_the_confidence_of_the_fields_it_names():
    contract = reference_contracts.reference_contract("sheng_siong_claim")
    contract["fields"]["revenue"] = {"status": "mapped", "source": "Supplier Claim", "confidence": "high"}
    checks, validated, _ = _run("sheng_siong_claim", "ss.xlsx", sheng_siong_xlsx(), contract)

    scored = mk.field_confidence(validated, checks)

    assert scored["fields"]["revenue"]["confidence"] == "low"
    assert scored["fields"]["sku"]["confidence"] == "high"


def test_a_models_low_confidence_is_never_raised_by_passing_checks():
    contract = reference_contracts.reference_contract("nhg_sap")
    contract["fields"]["store_name"]["confidence"] = "low"
    checks, validated, _ = _run("nhg_sap", "nhg.xlsx", nhg_xlsx(), contract)

    assert mk.field_confidence(validated, checks)["fields"]["store_name"]["confidence"] == "low"


def test_not_in_file_is_at_most_medium_while_a_column_goes_unread():
    contract = reference_contracts.reference_contract("fairprice_monthly")
    contract["fields"]["sku_range"] = {"status": "not_available", "reason": "No range column.", "confidence": "high"}
    checks, validated, frame = _run("fairprice_monthly", "fp.txt", fairprice_txt(), contract)

    assert "MCH" in mk.unused_columns(validated, list(frame.columns))
    scored = mk.field_confidence(validated, checks, list(frame.columns))
    assert scored["fields"]["sku_range"]["confidence"] == "medium"
    assert scored["fields"]["product_name"]["confidence"] == "high"


def test_not_in_file_keeps_its_confidence_when_every_column_is_read():
    contract = reference_contracts.reference_contract("fairprice_monthly")
    contract["fields"]["store_name"] = {"status": "not_available", "reason": "Codes only.", "confidence": "high"}
    checks, validated, frame = _run("fairprice_monthly", "fp.txt", fairprice_txt(), contract)
    read = [column for column in frame.columns if column not in mk.unused_columns(validated, list(frame.columns))]

    scored = mk.field_confidence(validated, checks, read)

    assert scored["fields"]["store_name"]["confidence"] == "high"
