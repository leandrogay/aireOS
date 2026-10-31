"""Execution of approved mapping contracts."""

import copy

import pandas as pd
import pytest
from conftest import prime_xlsx, singhealth_xlsx

from app.services import (
    apply_contract,
    column_profile,
    layout_detection,
    mapping_contract,
    sellout_ingestion,
    validation_service,
)
from app.services.reference_contracts import (
    FAIRPRICE_MONTHLY,
    NHG_SAP,
    PRIME_JKDC,
    SHENG_SIONG_CLAIM,
    SINGHEALTH_ER130,
)


def _validated(contract: dict, dataframe: pd.DataFrame) -> dict:
    return mapping_contract.validate_contract(
        contract,
        list(dataframe.columns),
        trust_review=True,
        samples=column_profile.column_samples(dataframe),
    )


def test_fairprice_contract_melts_transforms_and_aggregates_rows():
    dataframe = pd.DataFrame(
        [
            {
                "Store Format": "FPON",
                "Store Code": "4",
                "Store Name": "FAIRPRICE ON",
                "SKU No.": "13255043",
                "Article Description": "AIRE ADULT PANTS XL 10S",
                "Brand": "AIRE",
                "Dept Description": "TOILETRIES",
                "MCH": "ADULT DIAPER PANTS",
                "Sales UOM": "EA",
                "SALES | Month 1 | 01-01-2026": "100",
                "Qty (in EA) | Month 1 | 01-01-2026": "10",
            },
            {
                "Store Format": "FPON",
                "Store Code": "4",
                "Store Name": "FAIRPRICE ON",
                "SKU No.": "13255043",
                "Article Description": "AIRE ADULT PANTS XL 10S",
                "Brand": "AIRE",
                "Dept Description": "TOILETRIES",
                "MCH": "ADULT DIAPER PANTS",
                "Sales UOM": "CAR",
                "SALES | Month 1 | 01-01-2026": "20",
                "Qty (in EA) | Month 1 | 01-01-2026": "2",
            },
        ]
    )

    result = apply_contract.apply_contract(
        dataframe,
        _validated(FAIRPRICE_MONTHLY, dataframe),
        source_file="fairprice.txt",
    )

    assert len(result) == 1
    row = result.iloc[0]
    assert row["retailer"] == "fairprice_online"
    assert row["sku"] == "13255043"
    assert row["size"] == "XL"
    assert row["sku_range"] == "ADULT DIAPER PANTS"
    assert row["period_start"] == pd.Timestamp("2026-01-01")
    assert row["period_end"] == pd.Timestamp("2026-01-31")
    assert row["period_type"] == "month"
    assert row["quantity_units"] == 12
    assert row["revenue"] == 120
    assert row["source_file"] == "fairprice.txt"


def test_nhg_contract_maps_codes_negates_sales_and_rolls_up_without_a_store():
    dataframe = pd.DataFrame(
        [
            {
                "Posting Date": "2026-06-15",
                "Material": "0059-01-025-R",
                "Material Description": "AIRE ADULT PANTS L 10S",
                "Qty in Un. of Entry": "-3",
            },
            {
                "Posting Date": "2026-06-30",
                "Material": "0059-01-025-R",
                "Material Description": "AIRE ADULT PANTS L 10S",
                "Qty in Un. of Entry": "1",
            },
        ]
    )

    result = apply_contract.apply_contract(
        dataframe,
        _validated(NHG_SAP, dataframe),
        source_file="nhg.xlsx",
    )

    assert len(result) == 1
    row = result.iloc[0]
    assert row["retailer"] == "nhg_offline"
    assert row["sku"] == "13255045"
    assert row["size"] == "L"
    assert pd.isna(row["store_code"])
    assert row["quantity_units"] == 2
    assert pd.isna(row["revenue"])
    assert row["period_start"] == pd.Timestamp("2026-06-01")
    assert row["period_end"] == pd.Timestamp("2026-06-30")
    validated = validation_service.validate_mapped_dataframe(result)
    assert validated["rows_ingested"] == 1
    assert validated["total_rejected"] == 0


def test_sheng_siong_contract_melts_outlets_and_drops_zero_cells():
    dataframe = pd.DataFrame(
        [{
            "BusinessDate": "2026-06-12",
            "ItemCode": "1909284",
            "Description": "AIRE ADULT PANTS L 10S",
            "OUTLET": "",
            "2A": "3",
            "6M_Ecomm": "0",
            "Total": "3",
        }]
    )

    result = apply_contract.apply_contract(
        dataframe,
        _validated(SHENG_SIONG_CLAIM, dataframe),
        source_file="claim.xlsx",
    )

    assert len(result) == 1
    row = result.iloc[0]
    assert row["store_code"] == "2A"
    assert row["retailer"] == "sheng_siong_offline"
    assert row["sku"] == "13255045"
    assert row["quantity_units"] == 3
    assert row["period_start"] == pd.Timestamp("2026-06-01")
    assert row["source_file"] == "claim.xlsx"


# ---- Instructions read from the layout -------------------------------------------

def _transformed(contract: dict, filename: str, data: bytes) -> pd.DataFrame:
    """One synthetic upload read and transformed the way a confirmed upload is."""
    frame, layout = layout_detection.read_table(filename, data)
    proposed = copy.deepcopy(contract)
    proposed["layout"] = mapping_contract.layout_instructions(layout)
    return sellout_ingestion.transform_confirmed_upload(filename, data, _validated(proposed, frame))


def test_singhealth_reads_store_codes_above_the_header_and_names_from_it():
    result = _transformed(SINGHEALTH_ER130, "XEL.xlsx", singhealth_xlsx())

    stores = result.set_index("store_name")["store_code"].to_dict()
    assert stores == {"BEDOK": "81001", "ONLINE": "88001"}
    assert set(result.loc[result["store_name"] == "ONLINE", "retailer"]) == {"singhealth_online"}
    assert set(result.loc[result["store_name"] == "BEDOK", "retailer"]) == {"singhealth_offline"}


def test_singhealth_period_is_the_month_its_title_states():
    result = _transformed(SINGHEALTH_ER130, "XEL.xlsx", singhealth_xlsx())

    assert set(result["period_start"]) == {pd.Timestamp("2026-08-01")}
    assert set(result["period_end"]) == {pd.Timestamp("2026-08-31")}
    assert set(result["period_type"]) == {"month"}


def test_singhealth_revenue_is_units_times_the_unit_price_column():
    result = _transformed(SINGHEALTH_ER130, "XEL.xlsx", singhealth_xlsx())

    by_store_sku = result.set_index(["store_name", "sku"])
    assert by_store_sku.loc[("ONLINE", "13255044"), "quantity_units"] == 40
    assert by_store_sku.loc[("ONLINE", "13255044"), "revenue"] == pytest.approx(40 * 5.85)
    # A zero cell is no sale, not a row with nothing sold.
    assert ("BEDOK", "13271342") not in by_store_sku.index
    assert validation_service.validate_mapped_dataframe(result)["total_rejected"] == 0


def test_a_reviewer_can_value_singhealth_units_at_normal_cost_instead():
    contract = copy.deepcopy(SINGHEALTH_ER130)
    contract["fields"]["revenue"]["transforms"] = [{"type": "multiply", "column": "Normal cost"}]

    result = _transformed(contract, "XEL.xlsx", singhealth_xlsx())

    by_store_sku = result.set_index(["store_name", "sku"])
    assert by_store_sku.loc[("ONLINE", "13255044"), "revenue"] == pytest.approx(40 * 7.15)


def test_a_title_spanning_several_months_fails_a_stated_period_contract():
    data = singhealth_xlsx(period="01 Jul 2026 TO 31 Aug 2026")

    with pytest.raises(apply_contract.ContractApplicationError, match="more than one month"):
        _transformed(SINGHEALTH_ER130, "XEL.xlsx", data)


def test_a_file_whose_title_states_no_period_fails_a_stated_period_contract():
    dataframe = pd.DataFrame([{"Product Code": "0600-08-458-D", "Product Name": "X^", "Promo cost": "5", "BEDOK": "2"}])
    contract = _validated(SINGHEALTH_ER130, dataframe)

    with pytest.raises(apply_contract.ContractApplicationError, match="states no period"):
        apply_contract.apply_contract(dataframe, contract, layout={
            "header_row": 2,
            "rows_above_header": [{"row": 1, "cells": {"BEDOK": "81001"}}],
        })


def test_an_outlet_with_no_code_above_it_fails_rather_than_loading_as_all_stores():
    data = singhealth_xlsx(outlets=[("81001", "BEDOK"), ("", "NEWSTORE")])

    with pytest.raises(apply_contract.ContractApplicationError, match="NEWSTORE"):
        _transformed(SINGHEALTH_ER130, "XEL.xlsx", data)


def test_prime_withdrawals_roll_up_to_one_row_per_outlet_and_sku_each_month():
    result = _transformed(PRIME_JKDC, "XEL Lifecare JKDC Withdrawal Report (Aug'26).xlsx", prime_xlsx())

    totals = result.set_index(["store_code", "sku"])["quantity_units"].to_dict()
    assert totals == {("106", "13255045"): 24, ("WLM", "13255044"): 32}
    assert set(result["retailer"]) == {"prime_offline"}
    assert set(result["period_start"]) == {pd.Timestamp("2026-08-01")}


def test_one_outlet_heading_can_fill_both_the_store_code_and_the_store_name():
    contract = copy.deepcopy(SINGHEALTH_ER130)
    contract["melt_groups"][0]["key"] = {"target": "store_code"}
    contract["melt_groups"][0]["labels"] = [{"rows_above": 0, "target": "store_name"}]
    contract["fields"]["retailer"]["from_field"] = "store_code"

    result = _transformed(contract, "XEL.xlsx", singhealth_xlsx())

    assert set(zip(result["store_code"], result["store_name"])) == {("BEDOK", "BEDOK"), ("ONLINE", "ONLINE")}
    assert set(result.loc[result["store_code"] == "ONLINE", "retailer"]) == {"singhealth_online"}


# ---- Headings read for any descriptive field -----------------------------------------

PRODUCTS_PER_COLUMN = {
    "fields": {
        "period_start": {"status": "mapped", "source": "Month", "transforms": [{"type": "month_start"}]},
        "period_type": {"status": "constant", "value": "month"},
        "retailer": {"status": "constant", "value": "acme_offline"},
        "store_code": {"status": "mapped", "source": "Store"},
        "sku": {"status": "mapped", "melt_group": "products", "transforms": [
            {"type": "value_map", "values": {"A1": "13255043", "B2": "13255044"}},
        ]},
        "quantity_units": {"status": "mapped", "melt_group": "products"},
    },
    "melt_groups": [{
        "id": "products",
        "select": {"kind": "between", "after": "Store"},
        "key": {"target": "sku"},
        "value_target": "quantity_units",
    }],
}


def test_the_headings_can_also_fill_the_store_format_and_the_brand():
    contract = copy.deepcopy(SINGHEALTH_ER130)
    contract["melt_groups"][0]["labels"] = [
        {"rows_above": 1, "target": "store_code"},
        {"rows_above": 0, "target": "store_format"},
        {"rows_above": 0, "target": "brand"},
    ]
    contract["fields"]["store_format"] = {"status": "mapped", "melt_group": "outlets"}
    contract["fields"]["brand"] = {"status": "mapped", "melt_group": "outlets", "transforms": [
        {"type": "rules", "rules": [{"op": "equals", "value": "ONLINE", "output": "web"}], "default": "shop"},
    ]}

    result = _transformed(contract, "XEL.xlsx", singhealth_xlsx())

    assert set(zip(result["store_name"], result["store_format"], result["brand"])) == {
        ("BEDOK", "BEDOK", "shop"), ("ONLINE", "ONLINE", "web"),
    }


def test_a_file_with_one_column_per_product_reads_its_product_codes_from_the_headings():
    dataframe = pd.DataFrame([
        {"Month": "2026-08-14", "Store": "S1", "A1": "3", "B2": "5"},
        {"Month": "2026-08-20", "Store": "S2", "A1": "2", "B2": "0"},
    ])

    result = apply_contract.apply_contract(dataframe, _validated(PRODUCTS_PER_COLUMN, dataframe))

    totals = result.groupby("sku")["quantity_units"].apply(lambda values: pd.to_numeric(values).sum()).to_dict()
    assert totals == {"13255043": 5, "13255044": 5}
    assert set(result["store_code"]) == {"S1", "S2"}
