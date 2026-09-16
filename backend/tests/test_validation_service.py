import pandas as pd

from app.schemas.sellout import BUSINESS_COLUMNS
from app.services.validation_service import validate_mapped_dataframe


def _row(**changes):
    return {
        "period_start": "2026-01-01",
        "period_end": "2026-01-31",
        "period_type": "month",
        "retailer": "fairprice_offline",
        "store_code": "420",
        "sku": "13255043",
        "pack_size": "8",
        "quantity_units": "10",
        "revenue": "100.50",
        **changes,
    }


def test_invalid_row_does_not_reject_valid_row_with_same_dataframe_index():
    rows = pd.DataFrame([_row(), _row(revenue="invalid")], index=[0, 0])

    result = validate_mapped_dataframe(rows)

    assert result["rows_ingested"] == 1
    assert result["total_rejected"] == 1
    assert result["valid_df"].iloc[0]["revenue"] == 100.50


def test_validation_fills_optional_fields_and_standardises_valid_values():
    rows = pd.DataFrame([_row(sku=" 13255043 ")])

    result = validate_mapped_dataframe(rows)
    valid = result["valid_df"]

    assert list(valid.columns) == BUSINESS_COLUMNS
    assert valid.iloc[0]["sku"] == "13255043"
    assert valid.iloc[0]["period_start"] == "2026-01-01"
    assert valid.iloc[0]["pack_size"] == 8
    assert str(valid["pack_size"].dtype) == "Int64"
    assert pd.isna(valid.iloc[0]["product_name"])


def test_fractional_pack_size_rejects_only_invalid_row():
    rows = pd.DataFrame([_row(), _row(pack_size="8.5")])

    result = validate_mapped_dataframe(rows)

    assert result["rows_ingested"] == 1
    assert result["total_rejected"] == 1
    assert "invalid numeric pack_size" in result["rejection_summary"]
