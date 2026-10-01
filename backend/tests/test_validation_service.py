import pandas as pd

from app.services import validation_service


def _row(**changes):
    row = {
        "period_start": "2026-08-01",
        "period_end": "2026-08-31",
        "period_type": "month",
        "retailer": "fairprice_offline",
        "store_code": "420",
        "sku": "13255043",
        "pack_size": "8",
        "quantity_units": "10",
        "revenue": "100.50",
        "source_file": "august.xlsx",
    }
    row.update(changes)
    return row


def test_validation_converts_dates_and_numbers_for_storage():
    result = validation_service.validate_mapped_dataframe(pd.DataFrame([_row()]))
    row = result["valid_df"].iloc[0]

    assert result["rows_ingested"] == 1
    assert row["period_start"] == "2026-08-01"
    assert row["pack_size"] == 8
    assert row["quantity_units"] == 10
    assert row["revenue"] == 100.5


def test_validation_rejects_a_row_with_missing_keys_or_bad_numbers():
    dataframe = pd.DataFrame(
        [
            _row(),
            _row(store_code="", quantity_units="not-a-number"),
        ]
    )

    result = validation_service.validate_mapped_dataframe(dataframe)

    assert result["total_rows"] == 2
    assert result["rows_ingested"] == 1
    assert result["total_rejected"] == 1
    assert "missing store_code" in result["rejection_summary"]
    assert "invalid numeric quantity_units" in result["rejection_summary"]
