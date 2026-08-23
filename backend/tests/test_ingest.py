import io

import pandas as pd

from app.services.ingest import process_excel_file
from app.services.mapping_service import (
    FAIRPRICE_DIMENSION_HEADERS,
    TARGET_SCHEMA,
    extract_header_signature,
    find_matching_mapping,
)


BASE_ROW = {
    "Vendor Code": "73697",
    "Vendor Name": "XEL LIFECARE PTE LTD",
    "Dept Code": "31",
    "Dept Description": "TOILETRIES",
    "Class No.": "62",
    "Class Description": "BABY/SENIOR CARE",
    "Sub Class Description": "ADULT DIAPER",
    "MCH": "ADULT DIAPER PANTS",
    "SKU No.": "13255043",
    "Article Description": "AIRE       ADULT PANTS XL       10S",
    "Brand": "AIRE",
    "Sales UOM": "EA",
    "Pack Size": "8",
    "Store Code": "420",
    "Store Name": "AMK HYPERMART",
    "Store Format": "HYPER",
}


def _fairprice_df(period_type="Month", periods=2):
    row = dict(BASE_ROW)
    dates = (
        ["01-01-2026", "01-02-2026"]
        if period_type == "Month"
        else ["01-01-2026", "08-01-2026"]
    )
    for number, date in enumerate(dates[:periods], start=1):
        row[f"SALES | {period_type} {number} | {date}"] = str(100 * number)
    for number, date in enumerate(dates[:periods], start=1):
        row[f"Qty (in EA) | {period_type} {number} | {date}"] = str(10 * number)
    return pd.DataFrame([row])


def _as_txt_bytes(df):
    buffer = io.BytesIO()
    df.to_csv(buffer, sep="\t", index=False)
    return buffer.getvalue()


def test_monthly_file_maps_to_19_column_schema():
    result = process_excel_file(_as_txt_bytes(_fairprice_df()), "any-name.txt")

    assert result["rows_total"] == 2
    assert result["rows_ingested"] == 2
    assert result["rows_skipped"] == 0
    assert result["unmapped_fields"] == 0
    assert list(result["preview"][0]) == TARGET_SCHEMA
    assert result["preview"][0]["period_start"] == "2026-01-01"
    assert result["preview"][0]["period_end"] == "2026-01-31"
    assert result["preview"][0]["period_label"] == "2026-M01"
    assert result["preview"][0]["product_name"] == "Aire Adult Pants XL"
    assert result["preview"][0]["size"] == "XL"


def test_weekly_file_uses_same_mapping_engine():
    result = process_excel_file(_as_txt_bytes(_fairprice_df("Week")), "weekly.txt")

    assert result["rows_total"] == 2
    assert result["rows_ingested"] == 2
    assert result["preview"][0]["period_type"] == "week"
    assert result["preview"][0]["period_end"] == "2026-01-07"
    assert result["preview"][0]["period_label"] == "Week 1 (01-01-2026)"


def test_recognition_is_independent_of_filename():
    contents = _as_txt_bytes(_fairprice_df(periods=1))
    first = process_excel_file(contents, "fairprice.txt")
    second = process_excel_file(contents, "sheng-shiong-name.txt")

    assert first["rows_ingested"] == second["rows_ingested"] == 1
    assert first["preview"][0]["source_file"] == "fairprice.txt"
    assert second["preview"][0]["source_file"] == "sheng-shiong-name.txt"


def test_unrecognised_when_fixed_header_order_changes():
    df = _fairprice_df(periods=1)
    headers = list(df.columns)
    headers[0], headers[1] = headers[1], headers[0]
    df = df[headers]

    result = process_excel_file(_as_txt_bytes(df), "unknown.txt")

    assert result["rows_ingested"] == 0
    assert result["errors"] == "Header signature does not match any existing mapping."


def test_unrecognised_when_sales_and_quantity_periods_do_not_pair():
    df = _fairprice_df(periods=1).rename(
        columns={
            "Qty (in EA) | Month 1 | 01-01-2026":
            "Qty (in EA) | Month 1 | 01-02-2026"
        }
    )

    assert find_matching_mapping(extract_header_signature(df)) is None


def test_invalid_measure_rejects_only_its_period_row():
    df = _fairprice_df()
    df.loc[0, "Qty (in EA) | Month 2 | 01-02-2026"] = "not-a-number"

    result = process_excel_file(_as_txt_bytes(df), "monthly.txt")

    assert result["rows_total"] == 2
    assert result["rows_ingested"] == 1
    assert result["rows_skipped"] == 1
    assert "invalid numeric quantity_units" in result["errors"]


def test_signature_contains_exact_source_headers():
    df = _fairprice_df(periods=1)
    signature = extract_header_signature(df)

    assert signature[:16] == FAIRPRICE_DIMENSION_HEADERS
    assert find_matching_mapping(signature)["mapping_id"] == "fairprice_wide_v1"
