"""Execution of approved version 2 mapping contracts."""

import pandas as pd

from app.services import (
    apply_contract,
    column_profile,
    mapping_contract,
    validation_service,
)
from app.services.reference_contracts import (
    FAIRPRICE_MONTHLY,
    NHG_SAP,
    SHENG_SIONG_CLAIM,
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
