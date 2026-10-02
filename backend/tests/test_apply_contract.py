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


