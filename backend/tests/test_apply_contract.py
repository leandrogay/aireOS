"""Execution of approved mapping contracts."""

import copy

import pandas as pd
import pytest
from conftest import LEDGER_ROWS, ledger_csv, outlet_codes_below_xlsx, prime_sales_xlsx, prime_xlsx, singhealth_xlsx

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
    FAIRPRICE_WEEKLY,
    NHG_SAP,
    PRIME_JKDC,
    PRIME_SALES,
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


def test_weekly_rows_rolled_up_to_months_are_stored_as_months():
    # A weekly file with "Add up rows into monthly totals" on: the totals are
    # months, so they must not keep period_type 'week' (the dashboard's By week
    # view would show a whole month as one week starting on the 1st).
    contract = copy.deepcopy(FAIRPRICE_WEEKLY)
    contract["aggregate"] = mapping_contract.monthly_aggregate()
    row = {"Store Format": "FPON", "Store Code": "4", "Store Name": "FAIRPRICE ON",
           "SKU No.": "13255043", "Article Description": "AIRE ADULT PANTS XL 10S",
           "Brand": "AIRE", "Dept Description": "TOILETRIES", "MCH": "ADULT DIAPER PANTS",
           "Sales UOM": "EA"}
    dataframe = pd.DataFrame([{
        **row,
        "SALES | Week 1 | 05-01-2026": "100",
        "Qty (in EA) | Week 1 | 05-01-2026": "10",
        "SALES | Week 2 | 12-01-2026": "50",
        "Qty (in EA) | Week 2 | 12-01-2026": "5",
    }])

    result = apply_contract.apply_contract(dataframe, _validated(contract, dataframe), source_file="fp.txt")

    assert len(result) == 1
    month = result.iloc[0]
    assert month["period_type"] == "month"
    assert month["period_start"] == pd.Timestamp("2026-01-01")
    assert month["period_end"] == pd.Timestamp("2026-01-31")
    assert month["quantity_units"] == 15


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


def test_fairprice_pack_size_is_the_pieces_at_the_end_of_the_description():
    descriptions = pd.Series([
        "AIRE       ADULT PANTS  L       10S",
        "AIRE       ULTRA ADULT PANTS XL 12S",
    ])
    [transform] = FAIRPRICE_MONTHLY["fields"]["pack_size"]["transforms"]

    pack_sizes = apply_contract._apply_transform(descriptions, "pack_size", transform, pd.DataFrame())

    assert pack_sizes.tolist() == ["10", "12"]


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


# ---- Outlet codes under the headings ----------------------------------------------

CODES_BELOW = {
    "fields": {
        "period_start": {"status": "constant", "value": "2026-08-01"},
        "period_type": {"status": "constant", "value": "month"},
        "retailer": {"status": "constant", "value": "acme_offline"},
        "sku": {"status": "mapped", "source": "Aug-26", "transforms": [{"type": "value_map", "values": {
            "AIRE PULL UP PANTS SIZE S/M": "13255044", "AIRE PULL UP PANTS SIZE L": "13255045",
        }}]},
        "store_name": {"status": "mapped", "melt_group": "outlets"},
        "store_code": {"status": "mapped", "melt_group": "outlets"},
        "quantity_units": {"status": "mapped", "melt_group": "outlets", "transforms": [{"type": "zero_as_empty"}]},
    },
    "melt_groups": [{
        "id": "outlets",
        "select": {"kind": "columns", "columns": ["YISHUN", "TAMPINES"]},
        "key": {"target": "store_name"},
        "labels": [{"rows_below": 1, "target": "store_code"}],
        "value_target": "quantity_units",
    }],
    "aggregate": {"period": "month"},
}


@pytest.mark.parametrize("total_column", [True, False])
def test_outlet_codes_are_read_from_the_row_under_the_outlet_names(total_column):
    result = _transformed(CODES_BELOW, "codes.xlsx", outlet_codes_below_xlsx(total_column))

    totals = result.set_index(["store_code", "store_name", "sku"])["quantity_units"].to_dict()
    # The codes row is a heading whether or not a TOTAL cell set it aside: no
    # "SKUs" product or "HQ" quantity is loaded from it.
    assert totals == {
        ("HQ", "YISHUN", "13255044"): 34,
        ("HQ", "YISHUN", "13255045"): 38,
        ("OTH", "TAMPINES", "13255044"): 29,
    }
    assert validation_service.validate_mapped_dataframe(result)["total_rejected"] == 0


def _read_through(contract: dict, made_from: bytes, data: bytes) -> pd.DataFrame:
    """A file transformed through a contract validated and approved on another month's file."""
    frame, layout = layout_detection.read_table("made_from.xlsx", made_from)
    proposed = copy.deepcopy(contract)
    proposed["layout"] = mapping_contract.layout_instructions(layout)
    return sellout_ingestion.transform_confirmed_upload("next.xlsx", data, _validated(proposed, frame))


def test_julys_file_reads_through_the_contract_made_from_augusts_and_is_dated_july():
    contract = copy.deepcopy(CODES_BELOW)
    contract["fields"]["period_start"] = {"status": "derived", "from_layout": "stated_period"}

    result = _read_through(contract, outlet_codes_below_xlsx(), outlet_codes_below_xlsx(month="Jul-26"))

    assert set(result["period_start"]) == {pd.Timestamp("2026-07-01")}
    assert set(result["sku"]) == {"13255044", "13255045"}
    assert set(result["store_code"]) == {"HQ", "OTH"}


def test_a_fixed_august_date_fails_julys_file_rather_than_loading_it_as_august():
    with pytest.raises(apply_contract.ContractApplicationError, match="dates every row Aug 2026"):
        _read_through(CODES_BELOW, outlet_codes_below_xlsx(), outlet_codes_below_xlsx(month="Jul-26"))


def test_an_outlet_with_no_code_under_it_fails_rather_than_loading_as_all_stores():
    dataframe = pd.DataFrame([{"Aug-26": "AIRE PULL UP PANTS SIZE L", "YISHUN": "3", "TAMPINES": "4"}])
    layout = {"header_row": 1, "rows_below_header": [{"row": 2, "cells": {"YISHUN": "HQ"}, "in_table": False}]}

    with pytest.raises(apply_contract.ContractApplicationError, match="nothing below"):
        apply_contract.apply_contract(dataframe, _validated(CODES_BELOW, dataframe), layout=layout)


# ---- One cell written on every row --------------------------------------------------------

def test_julys_file_is_dated_by_the_month_in_cell_a1_through_augusts_contract():
    contract = copy.deepcopy(CODES_BELOW)
    contract["fields"]["period_start"] = {"status": "derived", "from_cell": "A1"}

    result = _read_through(contract, outlet_codes_below_xlsx(), outlet_codes_below_xlsx(month="Jul-26"))

    assert set(result["period_start"]) == {pd.Timestamp("2026-07-01")}
    assert set(result["period_end"]) == {pd.Timestamp("2026-07-31")}


def test_a_value_in_one_cell_is_written_on_every_row_after_its_steps():
    dataframe = pd.DataFrame([{"Product": "13255043", "Qty": "3"}, {"Product": "13255044", "Qty": "5"}])
    contract = {
        "fields": {
            "period_start": {"status": "derived", "from_cell": "B1"},
            "period_type": {"status": "constant", "value": "month"},
            "retailer": {"status": "derived", "from_cell": "A1", "transforms": [
                {"type": "value_map", "values": {"ACME STORES": "acme_offline"}},
            ]},
            "sku": {"status": "mapped", "source": "Product"},
            "quantity_units": {"status": "mapped", "source": "Qty"},
        },
    }
    layout = {"header_row": 2, "cells": {"A1": "ACME STORES", "B1": "01/08/2026", "A2": "Product", "B2": "Qty"}}

    result = apply_contract.apply_contract(dataframe, _validated(contract, dataframe), layout=layout)

    assert list(result["retailer"]) == ["acme_offline", "acme_offline"]
    assert list(result["period_start"]) == [pd.Timestamp("2026-08-01")] * 2


def test_an_empty_cell_fails_the_file_rather_than_loading_rows_without_a_value():
    dataframe = pd.DataFrame([{"Aug-26": "AIRE PULL UP PANTS SIZE L", "YISHUN": "3", "TAMPINES": "4"}])
    contract = copy.deepcopy(CODES_BELOW)
    contract["fields"]["period_start"] = {"status": "derived", "from_cell": "A1"}
    layout = {"header_row": 1, "cells": {}, "rows_below_header": [
        {"row": 2, "cells": {"YISHUN": "HQ", "TAMPINES": "OTH"}, "in_table": False},
    ]}

    with pytest.raises(apply_contract.ContractApplicationError, match="cell A1, which is empty"):
        apply_contract.apply_contract(dataframe, _validated(contract, dataframe), layout=layout)


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


# ---- Sample rows ----


def test_preview_rows_cover_each_retailer_and_store_before_repeating_the_first_store():
    frame = pd.DataFrame(
        {
            "retailer": ["x_offline"] * 4 + ["x_online"],
            "store_code": ["1", "1", "1", "2", "9"],
        }
    )

    rows = apply_contract.preview_rows(frame, 3)

    assert [(r["retailer"], r["store_code"]) for r in rows] == [
        ("x_offline", "1"),
        ("x_offline", "2"),
        ("x_online", "9"),
    ]


def test_preview_rows_fall_back_to_the_first_rows_without_spread_columns():
    frame = pd.DataFrame({"sku": ["a", "b", "c", "d"]})

    rows = apply_contract.preview_rows(frame, 2)

    assert [r["sku"] for r in rows] == ["a", "b"]


def test_preview_rows_pick_the_rows_that_add_the_most_new_values():
    frame = pd.DataFrame(
        {
            "retailer": ["x_offline"] * 6,
            "store_code": ["1", "1", "1", "1", "2", "3"],
            "sku": ["a", "a", "b", "c", "a", "a"],
        }
    )

    rows = apply_contract.preview_rows(frame, 3)

    # Every pick adds a value not shown yet; a repeat of store 1 + product a never does.
    assert len({(r["store_code"], r["sku"]) for r in rows}) == 3
    assert [r["sku"] for r in rows][0] == "a"
    assert len({r["sku"] for r in rows}) == 3


def test_preview_rows_include_a_negative_quantity_when_the_file_has_one():
    frame = pd.DataFrame(
        {
            "retailer": ["x_offline"] * 6,
            "store_code": ["1"] * 6,
            "quantity_units": [1, 2, 3, 4, 5, -2],
        }
    )

    rows = apply_contract.preview_rows(frame, 3)

    assert -2 in [r["quantity_units"] for r in rows]


def test_preview_rows_include_a_row_with_a_missing_value():
    frame = pd.DataFrame(
        {
            "retailer": ["x_offline"] * 4,
            "store_code": ["1", "1", "1", None],
            "quantity_units": [1, 2, 3, 4],
        }
    )

    rows = apply_contract.preview_rows(frame, 3)

    assert None in [r["store_code"] for r in rows]


def test_preview_rows_keep_the_whole_sample_for_the_spread_when_it_is_tiny():
    frame = pd.DataFrame(
        {
            "retailer": ["x_offline", "x_offline", "x_online"],
            "quantity_units": [1, -1, 2],
        }
    )

    rows = apply_contract.preview_rows(frame, 2)

    assert {r["retailer"] for r in rows} == {"x_offline", "x_online"}


# ---- Reading how values are written ------------------------------------------------------
#
# A small table of text cells and a contract over it: one step at a time, then
# a whole file (conftest ledger_csv) that needs most of them at once.

def _not_in_file() -> dict:
    return {"status": "not_available", "reason": "Not in this table."}


def _rows(table: dict, **fields) -> pd.DataFrame:
    """The table run through a contract that dates every row August and reads the fields given."""
    frame = pd.DataFrame(table, dtype=object)
    contract = {
        "fields": {
            "period_start": {"status": "constant", "value": "2026-08-01"},
            "period_type": {"status": "constant", "value": "month"},
            "retailer": {"status": "constant", "value": "acme_offline"},
            "sku": {"status": "mapped", "source": "Item"},
            **fields,
        },
        "melt_groups": [],
    }
    validated = _validated(contract, frame)
    assert validated["warnings"] == []
    return apply_contract.apply_contract(frame, validated, source_file="table.csv")


def _read(column: str, *steps: dict) -> dict:
    return {"status": "mapped", "source": column, "transforms": list(steps)}


def test_parse_number_reads_currency_thousands_and_bracketed_negatives():
    rows = _rows(
        {"Item": ["a", "b", "c"], "Qty": ["1", "1", "1"], "Sales": ["$1,250.50", "(120.00)", "SGD 3"]},
        quantity_units=_read("Qty"), revenue=_read("Sales", {"type": "parse_number"}),
    )

    assert rows["revenue"].tolist() == [1250.5, -120.0, 3.0]


def test_parse_number_reads_a_decimal_comma_when_told_to():
    rows = _rows(
        {"Item": ["a"], "Qty": ["1.250,5"]},
        quantity_units=_read("Qty", {"type": "parse_number", "decimal": ","}),
    )

    assert rows["quantity_units"].tolist() == [1250.5]


def test_a_percentage_becomes_a_fraction_with_parse_number_then_scale():
    rows = _rows(
        {"Item": ["a"], "Qty": ["15%"]},
        quantity_units=_read("Qty", {"type": "parse_number"}, {"type": "scale", "factor": 0.01}),
    )

    assert rows["quantity_units"].tolist() == pytest.approx([0.15])


def test_a_figure_no_step_can_read_is_rejected_and_counted_not_dropped():
    rows = _rows({"Item": ["a", "b"], "Qty": ["5", "five"]}, quantity_units=_read("Qty", {"type": "negate"}))

    validated = validation_service.validate_mapped_dataframe(rows)
    assert len(rows) == 2
    assert validated["valid_df"]["quantity_units"].tolist() == [-5.0]
    assert validated["rejection_summary"] == "1 rows rejected: 1 rows with invalid numeric quantity_units"


def test_a_figure_that_cannot_be_read_is_left_out_of_a_monthly_total_and_rejected():
    frame = pd.DataFrame({"Item": ["a", "a", "a"], "Qty": ["5", "$7", "6"]}, dtype=object)
    contract = _validated({
        "fields": {
            "period_start": {"status": "constant", "value": "2026-08-01"},
            "period_type": {"status": "constant", "value": "month"},
            "retailer": {"status": "constant", "value": "acme_offline"},
            "sku": {"status": "mapped", "source": "Item"},
            "quantity_units": {"status": "mapped", "source": "Qty"},
        },
        "melt_groups": [],
        "aggregate": {"period": "month"},
    }, frame)

    validated = validation_service.validate_mapped_dataframe(apply_contract.apply_contract(frame, contract))

    # Unread, "$7" used to vanish from the sum without a word.
    assert validated["valid_df"]["quantity_units"].tolist() == [11.0]
    assert validated["total_rejected"] == 1


def test_blank_if_turns_placeholders_into_empty_cells_before_they_are_read():
    rows = _rows(
        {"Item": ["a", "b", "c"], "Qty": ["5", "N/A", "-"]},
        quantity_units=_read("Qty", {"type": "blank_if", "tokens": ["n/a", "-"]}, {"type": "parse_number"}),
    )

    assert rows["quantity_units"].tolist() == [5.0]


def test_fill_empty_takes_a_default_or_the_same_rows_value_in_another_column():
    rows = _rows(
        {"Item": ["a", "b"], "Qty": ["1", "1"], "Store": ["BB17", None], "Branch": ["x", "CC08"], "Format": [None, "HYPER"]},
        quantity_units=_read("Qty"),
        store_code=_read("Store", {"type": "fill_empty", "column": "Branch"}),
        store_format=_read("Format", {"type": "fill_empty", "default": "UNKNOWN"}),
    )

    assert rows["store_code"].tolist() == ["BB17", "CC08"]
    assert rows["store_format"].tolist() == ["UNKNOWN", "HYPER"]


def test_split_part_takes_one_part_of_a_compound_value():
    rows = _rows(
        {"Item": ["a", "b"], "Qty": ["1", "1"], "Outlet": ["BB17 - BEDOK", "CC08"]},
        quantity_units=_read("Qty"),
        store_code=_read("Outlet", {"type": "split_part", "separator": "-", "index": 1}),
        store_name=_read("Outlet", {"type": "split_part", "separator": "-", "index": 2}),
    )

    assert rows["store_code"].tolist() == ["BB17", "CC08"]
    assert rows["store_name"].tolist()[0] == "BEDOK" and pd.isna(rows["store_name"].tolist()[1])


def test_replace_and_normalize_text_tidy_a_description():
    rows = _rows(
        {"Item": ["a"], "Qty": ["1"], "Name": ["  aire   adult pants xl^ "]},
        quantity_units=_read("Qty"),
        product_name=_read(
            "Name", {"type": "replace", "pattern": r"\^$", "replacement": ""}, {"type": "normalize_text", "case": "upper"},
        ),
    )

    assert rows["product_name"].tolist() == ["AIRE ADULT PANTS XL"]


def test_concat_joins_two_columns_so_a_code_table_can_read_them_together():
    table = {"Range": ["PANTS", "PANTS"], "Size": ["XL", "L"], "Item": ["x", "y"], "Qty": ["1", "2"]}
    frame = pd.DataFrame(table, dtype=object)
    contract = _validated({
        "fields": {
            "period_start": {"status": "constant", "value": "2026-08-01"},
            "period_type": {"status": "constant", "value": "month"},
            "retailer": {"status": "constant", "value": "acme_offline"},
            "sku": _read(
                "Range", {"type": "concat", "columns": ["Size"], "separator": "|"},
                {"type": "value_map", "values": {"PANTS|XL": "13255043", "PANTS|L": "13255045"}},
            ),
            "quantity_units": _read("Qty"),
        },
        "melt_groups": [],
    }, frame)

    assert apply_contract.apply_contract(frame, contract)["sku"].tolist() == ["13255043", "13255045"]


def test_a_type_column_marks_returns_with_a_negative_factor():
    rows = _rows(
        {"Item": ["a", "a"], "Qty": ["5", "2"], "Type": ["SALE", "RETURN"]},
        quantity_units=_read("Qty", {"type": "uom_factor", "column": "Type", "factors": {"RETURN": -1}, "default": 1}),
    )

    assert rows["quantity_units"].tolist() == [5.0, -2.0]


def test_pieces_divided_by_the_pack_size_are_packs():
    rows = _rows(
        {"Item": ["a"], "Pieces": ["120"], "Per pack": ["10"]},
        quantity_units=_read("Pieces", {"type": "divide", "column": "Per pack"}),
    )

    assert rows["quantity_units"].tolist() == [12.0]


def test_dividing_by_an_empty_or_zero_cell_fails_the_file():
    with pytest.raises(apply_contract.ContractApplicationError, match="empty or 0 on 1 rows"):
        _rows(
            {"Item": ["a", "b"], "Pieces": ["120", "50"], "Per pack": ["10", "0"]},
            quantity_units=_read("Pieces", {"type": "divide", "column": "Per pack"}),
        )


def test_add_and_subtract_use_another_column_and_an_empty_cell_changes_nothing():
    rows = _rows(
        {"Item": ["a", "b"], "Sold": ["10", "4"], "Returned": ["3", None], "Net": ["90", "40"], "Discount": ["$10.00", None]},
        quantity_units=_read("Sold", {"type": "subtract", "column": "Returned"}),
        revenue=_read("Net", {"type": "add", "column": "Discount"}),
    )

    assert rows["quantity_units"].tolist() == [7.0, 4.0]
    assert rows["revenue"].tolist() == [100.0, 40.0]


# ---- Dates ---------------------------------------------------------------------------------

def _dated(dates: list[str], *steps: dict, period_type: str = "month") -> pd.DataFrame:
    frame = pd.DataFrame({"Item": ["a"] * len(dates), "Qty": ["1"] * len(dates), "Date": dates}, dtype=object)
    contract = _validated({
        "fields": {
            "period_start": _read("Date", *steps),
            "period_type": {"status": "constant", "value": period_type},
            "retailer": {"status": "constant", "value": "acme_offline"},
            "sku": {"status": "mapped", "source": "Item"},
            "quantity_units": {"status": "mapped", "source": "Qty"},
        },
        "melt_groups": [],
    }, frame)
    return validation_service.validate_mapped_dataframe(apply_contract.apply_contract(frame, contract))


def test_a_day_first_date_is_read_by_its_format_into_its_month():
    validated = _dated(["01/02/2026", "31/12/2025"], {"type": "month_start", "format": "%d/%m/%Y"})

    assert validated["valid_df"]["period_start"].tolist() == ["2026-02-01", "2025-12-01"]


def test_a_date_with_no_format_given_is_rejected_rather_than_guessed():
    # Read month first, 01/02/2026 would have loaded as January without a word.
    validated = _dated(["01/02/2026"], {"type": "month_start"})

    assert validated["rows_ingested"] == 0
    assert "invalid period_start format" in validated["rejection_summary"]


def test_parse_date_keeps_the_day_for_weekly_rows():
    validated = _dated(["03-Aug-26"], {"type": "parse_date", "format": "%d-%b-%y"}, period_type="week")

    assert validated["valid_df"][["period_start", "period_end"]].values.tolist() == [["2026-08-03", "2026-08-09"]]


def test_an_excel_day_count_is_read_as_its_date():
    validated = _dated(["46235"], {"type": "month_start", "format": "excel_serial"})

    assert validated["valid_df"]["period_start"].tolist() == ["2026-08-01"]


def test_a_typed_month_is_read_as_the_first_of_that_month():
    frame = pd.DataFrame({"Item": ["a"], "Qty": ["1"]}, dtype=object)
    contract = _validated({
        "fields": {
            "period_start": {"status": "constant", "value": "Aug 2026"},
            "period_type": {"status": "constant", "value": "month"},
            "retailer": {"status": "constant", "value": "acme_offline"},
            "sku": {"status": "mapped", "source": "Item"},
            "quantity_units": {"status": "mapped", "source": "Qty"},
        },
        "melt_groups": [],
    }, frame)

    assert apply_contract.apply_contract(frame, contract)["period_start"].tolist() == [pd.Timestamp("2026-08-01")]


# ---- Row filters ------------------------------------------------------------------------------

def _filtered(filters: list[dict]) -> pd.DataFrame:
    frame = pd.DataFrame(
        {"Item": ["a", "b", None, "c"], "Qty": ["1", "2", "3", "4"], "Type": ["SALE", "TRANSFER", "SALE", "sale"]},
        dtype=object,
    )
    contract = _validated({
        "fields": {
            "period_start": {"status": "constant", "value": "2026-08-01"},
            "period_type": {"status": "constant", "value": "month"},
            "retailer": {"status": "constant", "value": "acme_offline"},
            "sku": {"status": "mapped", "source": "Item"},
            "quantity_units": {"status": "mapped", "source": "Qty"},
        },
        "melt_groups": [],
        "filters": filters,
    }, frame)
    return apply_contract.apply_contract(frame, contract)


def test_a_drop_filter_leaves_the_matching_rows_out():
    rows = _filtered([{"column": "Type", "op": "equals", "value": "transfer", "action": "drop"}])

    assert rows["quantity_units"].tolist() == ["1", "3", "4"]


def test_a_keep_filter_loads_only_the_matching_rows():
    rows = _filtered([{"column": "Type", "op": "equals", "value": "SALE", "action": "keep", "case_sensitive": True}])

    assert rows["quantity_units"].tolist() == ["1", "3"]


def test_filters_apply_in_order_and_an_empty_cell_can_be_filtered_on():
    rows = _filtered([
        {"column": "Item", "op": "empty", "action": "drop"},
        {"column": "Type", "op": "equals", "value": "TRANSFER", "action": "drop"},
    ])

    assert rows["sku"].tolist() == ["a", "c"]


def test_a_filter_on_a_column_the_file_lacks_fails_the_file():
    with pytest.raises(apply_contract.ContractApplicationError, match="'Status' is not in the file"):
        _filtered([{"column": "Status", "op": "equals", "value": "VOID", "action": "drop"}])


# ---- A whole file that needs the steps together ---------------------------------------------

LEDGER = {
    "fields": {
        "period_start": _read("Txn Date", {"type": "month_start", "format": "%d/%m/%Y"}),
        "period_type": {"status": "constant", "value": "month"},
        "retailer": {"status": "constant", "value": "acme_offline"},
        "store_code": _read("Outlet", {"type": "split_part", "separator": " - ", "index": 1}),
        "store_name": _read(
            "Outlet", {"type": "split_part", "separator": " - ", "index": 2}, {"type": "normalize_text", "case": "title"},
        ),
        "sku": _read("Item", {"type": "value_map", "values": {"A-1": "13255043", "A-2": "13255044"}}),
        "quantity_units": _read(
            "Qty", {"type": "parse_number"},
            {"type": "uom_factor", "column": "Type", "factors": {"RETURN": -1}, "default": 1},
        ),
        # Gross sales: what was taken plus what was given away.
        "revenue": _read("Net Sales", {"type": "parse_number"}, {"type": "add", "column": "Discount"}),
    },
    "melt_groups": [],
    "filters": [
        {"column": "Supplier", "op": "equals", "value": "XEL", "action": "keep"},
        {"column": "Type", "op": "equals", "value": "TRANSFER", "action": "drop"},
    ],
    "aggregate": {"period": "month"},
}


def test_a_text_export_is_read_into_the_standard_rows():
    rows = _transformed(LEDGER, "ledger.csv", ledger_csv())
    validated = validation_service.validate_mapped_dataframe(rows)

    assert validated["rejection_summary"] == ""
    assert validated["valid_df"][
        ["period_start", "period_end", "store_code", "store_name", "sku", "quantity_units", "revenue"]
    ].values.tolist() == [
        ["2026-08-01", "2026-08-31", "BB17", "Bedok North", "13255043", 1203.0, 1330.5],
        ["2026-08-01", "2026-08-31", "CC08", "Clementi", "13255044", -2.0, -20.0],
    ]


def test_the_same_figures_written_plainly_give_the_same_rows():
    def plain(row):
        date, kind, outlet, item, supplier, quantity, net, discount = row
        day, month, year = date.split("/")
        figures = {"1,200": "1200", "$1,250.50": "1250.5", "($20.00)": "-20", "N/A": ""}
        return [
            f"{year}-{month}-{day}", kind, outlet, item, supplier, figures.get(quantity, quantity),
            figures.get(net, net.lstrip("$")), figures.get(discount, discount.lstrip("$")),
        ]

    contract = copy.deepcopy(LEDGER)
    contract["fields"]["period_start"]["transforms"] = [{"type": "month_start"}]

    written_plainly = _transformed(contract, "ledger.csv", ledger_csv([plain(row) for row in LEDGER_ROWS]))
    written_awkwardly = _transformed(LEDGER, "ledger.csv", ledger_csv())

    pd.testing.assert_frame_equal(written_plainly, written_awkwardly)


# ---- Sheets stacked, and the period in the file's name ---------------------------------------

def test_every_sheet_of_a_one_sheet_per_product_workbook_is_loaded():
    rows = _transformed(PRIME_SALES, "Prime - Jan 2026 - Sales report.xlsx", prime_sales_xlsx())

    assert rows[["period_start", "store_code", "sku", "quantity_units"]].values.tolist() == [
        [pd.Timestamp("2026-01-01"), "BB17", "13255045", 3.0],
        [pd.Timestamp("2026-01-01"), "CC08", "13255045", 3.0],
        [pd.Timestamp("2026-01-01"), "BB17", "13255044", 4.0],
    ]


def test_next_months_file_is_dated_by_its_own_name():
    rows = _transformed(PRIME_SALES, "Prime - Feb 2026 - Sales report.xlsx", prime_sales_xlsx())

    assert set(rows["period_start"]) == {pd.Timestamp("2026-02-01")}


def test_a_file_whose_name_states_no_month_fails_a_filename_period_contract():
    with pytest.raises(apply_contract.ContractApplicationError, match="states no month"):
        _transformed(PRIME_SALES, "Prime sales report.xlsx", prime_sales_xlsx())


# ---- The same file and contract always give the same rows -------------------------------------

@pytest.mark.parametrize("name", [
    "fairprice_monthly", "nhg_sap", "sheng_siong_claim", "singhealth_er130", "prime_jkdc", "pharmex_grid", "prime_sales",
])
def test_transforming_a_file_twice_gives_identical_rows(name, retailer_files):
    from app.services import reference_contracts

    filename, data = retailer_files[name]
    contract = reference_contracts.reference_contract(name)

    first = _transformed(contract, filename, data)
    second = _transformed(contract, filename, data)

    assert len(first) > 0
    pd.testing.assert_frame_equal(first, second)
