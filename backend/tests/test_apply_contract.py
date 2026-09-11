import pandas as pd
import pytest

from app.services.apply_contract import ContractApplicationError, apply_contract


def _contract():
    return {
        "identity_mapping": {"SKU": "sku"},
        "melt_groups": [
            {
                "target_field": "revenue",
                "columns": ["Sales | Week 1 | 01-01-2026"],
                "period_extract_regex": r"Sales \| Week \d+ \| (\d{2}-\d{2}-\d{4})$",
                "date_format": "%d-%m-%Y",
            },
            {
                "target_field": "quantity_units",
                "columns": ["Qty | Week 1 | 01-01-2026"],
                "period_extract_regex": r"Qty \| Week \d+ \| (\d{2}-\d{2}-\d{4})$",
                "date_format": "%d-%m-%Y",
            },
        ],
    }


def test_literal_columns_are_used_when_present():
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1"],
            "Sales | Week 1 | 01-01-2026": ["12.50"],
            "Qty | Week 1 | 01-01-2026": ["2"],
        }
    )

    result = apply_contract(dataframe, _contract())

    assert result.iloc[0]["revenue"] == "12.50"
    assert result.iloc[0]["quantity_units"] == "2"


def test_rediscovers_columns_when_the_confirmed_range_has_moved_on():
    # A later file from the same feed, six weeks after the one the contract
    # was confirmed against — none of the literal stored column names exist.
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1"],
            "Sales | Week 7 | 12-02-2026": ["30.00"],
            "Qty | Week 7 | 12-02-2026": ["5"],
        }
    )

    result = apply_contract(dataframe, _contract())

    assert result.iloc[0]["sku"] == "A1"
    assert result.iloc[0]["revenue"] == "30.00"
    assert result.iloc[0]["quantity_units"] == "5"
    assert str(result.iloc[0]["period_start"].date()) == "2026-02-12"


def test_rediscovery_keeps_distinct_melt_groups_from_colliding():
    # Two metrics reporting the same three weeks -- rediscovery must not let
    # the quantity regex accidentally pick up a revenue column or vice versa.
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1"],
            "Sales | Week 1 | 01-01-2026": ["10"],
            "Sales | Week 2 | 08-01-2026": ["20"],
            "Qty | Week 1 | 01-01-2026": ["1"],
            "Qty | Week 2 | 08-01-2026": ["2"],
        }
    )

    result = apply_contract(dataframe, _contract())

    assert sorted(result["revenue"].tolist()) == ["10", "20"]
    assert sorted(result["quantity_units"].tolist()) == ["1", "2"]


def test_raises_when_nothing_matches_the_stored_pattern():
    dataframe = pd.DataFrame({"SKU": ["A1"], "Totally Unrelated Column": ["x"]})

    with pytest.raises(ContractApplicationError, match="No columns in this file match"):
        apply_contract(dataframe, _contract())


def test_raises_instead_of_silently_corrupting_data_when_groups_overlap():
    # A contract whose two regexes both match ANY parenthesized date, with no
    # metric-specific prefix to tell them apart -- validate_contract only
    # warns about this at confirm time (see test_validate_contract.py), so
    # apply_contract is the last line of defense against actually melting
    # the same column into two metrics and corrupting the merge.
    contract = {
        "identity_mapping": {"SKU": "sku"},
        "melt_groups": [
            {
                "target_field": "revenue",
                "columns": ["Amt Wk1 (01-01-2026)"],
                "period_extract_regex": r"\((\d{2}-\d{2}-\d{4})\)",
                "date_format": "%d-%m-%Y",
            },
            {
                "target_field": "quantity_units",
                "columns": ["Qty Wk1 (01-01-2026)"],
                "period_extract_regex": r"\((\d{2}-\d{2}-\d{4})\)",
                "date_format": "%d-%m-%Y",
            },
        ],
    }
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1"],
            "Amt Wk1 (01-01-2026)": ["150.00"],
            "Qty Wk1 (01-01-2026)": ["33"],
        }
    )

    with pytest.raises(ContractApplicationError, match="matches the period pattern for both"):
        apply_contract(dataframe, contract)
