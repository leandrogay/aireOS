import io

import pandas as pd

from app.routers import uploads
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


def _as_txt_bytes(dataframe):
    buffer = io.BytesIO()
    dataframe.to_csv(buffer, sep="\t", index=False)
    return buffer.getvalue()


def test_monthly_file_maps_through_upload_flow():
    result = uploads.resolve_and_apply_mapping(
        "any-name.txt", _as_txt_bytes(_fairprice_df())
    )
    processing = result["processing"]

    assert result["status"] == "mapped"
    assert result["source"] == "builtin"
    assert processing["rows_total"] == 2
    assert processing["rows_mapped"] == 2
    assert processing["rows_rejected"] == 0
    assert processing["columns"] == TARGET_SCHEMA
    assert processing["preview"][0]["period_start"] == "2026-01-01"
    assert processing["preview"][0]["period_end"] == "2026-01-31"
    assert processing["preview"][0]["period_label"] == "2026-M01"


def test_weekly_file_uses_same_upload_flow():
    result = uploads.resolve_and_apply_mapping(
        "weekly.txt", _as_txt_bytes(_fairprice_df("Week"))
    )

    assert result["processing"]["rows_mapped"] == 2
    assert result["processing"]["preview"][0]["period_type"] == "week"
    assert result["processing"]["preview"][0]["period_end"] == "2026-01-07"


def test_recognition_remains_independent_of_filename():
    contents = _as_txt_bytes(_fairprice_df(periods=1))
    first = uploads.resolve_and_apply_mapping("fairprice.txt", contents)
    second = uploads.resolve_and_apply_mapping("another-retailer-name.txt", contents)

    assert first["mapping_id"] == second["mapping_id"] == "fairprice_wide_v1"
    assert first["processing"]["preview"][0]["source_file"] == "fairprice.txt"
    assert second["processing"]["preview"][0]["source_file"] == "another-retailer-name.txt"


def test_unrecognised_file_continues_to_proposal_flow(monkeypatch):
    dataframe = pd.DataFrame({"Unknown A": [1], "Unknown B": [2]})
    pending = {
        "status": "pending_confirmation",
        "fingerprint": "abc123",
        "contract": {"identity_mapping": {}, "melt_groups": []},
    }
    monkeypatch.setattr(uploads.generate_mapping, "resolve_mapping", lambda *_: pending)

    result = uploads.resolve_and_apply_mapping(
        "unknown.txt", _as_txt_bytes(dataframe), "gs://bucket/unknown.txt"
    )

    assert result == pending
    assert "processing" not in result


def test_invalid_measure_rejects_only_its_period_row():
    dataframe = _fairprice_df()
    dataframe.loc[0, "Qty (in EA) | Month 2 | 01-02-2026"] = "not-a-number"

    result = uploads.resolve_and_apply_mapping(
        "monthly.txt", _as_txt_bytes(dataframe)
    )

    assert result["processing"]["rows_total"] == 2
    assert result["processing"]["rows_mapped"] == 1
    assert result["processing"]["rows_rejected"] == 1
    assert "invalid numeric quantity_units" in result["processing"]["rejection_summary"]


def test_confirmed_contract_is_applied_deterministically(monkeypatch):
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1"],
            "Sales | Week 1 | 01-01-2026": ["12.50"],
            "Qty | Week 1 | 01-01-2026": ["2"],
        }
    )
    contract = {
        "identity_mapping": {"SKU": "sku"},
        "melt_groups": [
            {
                "target_field": "revenue",
                "columns": ["Sales | Week 1 | 01-01-2026"],
                "period_extract_regex": r"(\d{2}-\d{2}-\d{4})$",
                "date_format": "%d-%m-%Y",
            },
            {
                "target_field": "quantity_units",
                "columns": ["Qty | Week 1 | 01-01-2026"],
                "period_extract_regex": r"(\d{2}-\d{2}-\d{4})$",
                "date_format": "%d-%m-%Y",
            },
        ],
    }
    monkeypatch.setattr(
        uploads.generate_mapping,
        "resolve_mapping",
        lambda *_: {
            "status": "mapped",
            "fingerprint": "confirmed123",
            "contract": contract,
            "source": "cache",
        },
    )

    result = uploads.resolve_and_apply_mapping(
        "vendor.txt", _as_txt_bytes(dataframe), "gs://bucket/vendor.txt"
    )

    preview = result["processing"]["preview"][0]
    assert result["processing"]["rows_mapped"] == 1
    assert preview["sku"] == "A1"
    assert preview["period_start"] == "2026-01-01"
    assert preview["period_end"] == "2026-01-07"
    assert preview["period_type"] == "week"
    assert preview["revenue"] == "12.50"
    assert preview["quantity_units"] == "2"


def test_signature_contains_exact_source_headers():
    dataframe = _fairprice_df(periods=1)
    signature = extract_header_signature(dataframe)

    assert signature[:16] == FAIRPRICE_DIMENSION_HEADERS
    assert find_matching_mapping(signature)["mapping_id"] == "fairprice_wide_v1"
