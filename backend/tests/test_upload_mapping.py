import io

import pandas as pd
import pytest

from app.routers import uploads


@pytest.fixture(autouse=True)
def disable_live_cloud_sql(monkeypatch):
    """Unit tests must never inherit a developer's live-write setting."""
    monkeypatch.setenv("CLOUD_SQL_LOAD_ENABLED", "false")


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


def test_column_samples_use_distinct_values_instead_of_repeating_first_rows():
    dataframe = pd.DataFrame(
        {"Store Format": ["FPON", "FPON", "HYPER", "SUPER", "HYPER"]}
    )

    assert uploads.generate_mapping.column_samples(dataframe) == {
        "Store Format": ["FPON", "HYPER", "SUPER"]
    }


def test_fairprice_shaped_file_uses_gcs_resolution(monkeypatch):
    pending = {
        "status": "pending_confirmation",
        "fingerprint": "gcs123",
        "source": "generated",
    }
    calls = []

    def resolve(filename, data, uploaded_to):
        calls.append((filename, uploaded_to))
        return pending

    monkeypatch.setattr(uploads.generate_mapping, "resolve_mapping", resolve)

    result = uploads.resolve_and_apply_mapping(
        "fairprice.txt",
        _as_txt_bytes(_fairprice_df()),
        "gs://bucket/fairprice.txt",
    )

    assert result == pending
    assert calls == [("fairprice.txt", "gs://bucket/fairprice.txt")]


def test_unrecognised_file_continues_to_proposal_flow(monkeypatch):
    dataframe = pd.DataFrame({"Unknown A": [1], "Unknown B": [2]})
    pending = {
        "status": "pending_confirmation",
        "fingerprint": "abc123",
        "contract": {"identity_mapping": {}, "melt_groups": []},
    }
    monkeypatch.setattr(
        uploads.generate_mapping,
        "resolve_mapping",
        lambda *_: pending,
    )

    result = uploads.resolve_and_apply_mapping(
        "unknown.txt",
        _as_txt_bytes(dataframe),
        "gs://bucket/unknown.txt",
    )

    assert result == pending
    assert "processing" not in result


def test_confirmed_contract_is_applied_deterministically(monkeypatch):
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1"],
            "Retailer": ["fairprice_online"],
            "Store Code": ["FPON"],
            "Sales | Week 1 | 01-01-2026": ["12.50"],
            "Qty | Week 1 | 01-01-2026": ["2"],
        }
    )
    contract = {
        "identity_mapping": {
            "SKU": "sku",
            "Retailer": "retailer",
            "Store Code": "store_code",
        },
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
        "vendor.txt",
        _as_txt_bytes(dataframe),
        "gs://bucket/vendor.txt",
    )

    preview = result["processing"]["preview"][0]
    assert result["processing"]["rows_mapped"] == 1
    assert preview["sku"] == "A1"
    assert preview["period_start"] == "2026-01-01"
    assert preview["period_end"] == "2026-01-07"
    assert preview["period_type"] == "week"
    assert preview["revenue"] == 12.5
    assert preview["quantity_units"] == 2
    assert result["processing"]["rows_stored"] == 0
    assert result["processing"]["storage_status"] == "disabled"


def test_confirmed_contract_stores_valid_rows_when_enabled(monkeypatch):
    dataframe = pd.DataFrame(
        {
            "SKU": ["A1"],
            "Retailer": ["fairprice_online"],
            "Store Code": ["FPON"],
            "Sales | Month 1 | 01-08-2026": ["12.50"],
            "Qty | Month 1 | 01-08-2026": ["2"],
        }
    )
    contract = {
        "identity_mapping": {
            "SKU": "sku",
            "Retailer": "retailer",
            "Store Code": "store_code",
        },
        "melt_groups": [
            {
                "target_field": "revenue",
                "columns": ["Sales | Month 1 | 01-08-2026"],
                "period_extract_regex": r"(\d{2}-\d{2}-\d{4})$",
                "date_format": "%d-%m-%Y",
            },
            {
                "target_field": "quantity_units",
                "columns": ["Qty | Month 1 | 01-08-2026"],
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
        },
    )
    monkeypatch.setenv("CLOUD_SQL_LOAD_ENABLED", "true")
    captured = {}

    def load(dataframe, *, replace_source=False):
        captured["rows"] = len(dataframe)
        captured["replace_source"] = replace_source
        captured["period_type"] = dataframe.iloc[0]["period_type"]
        return {
            "rows_stored": len(dataframe),
            "rows_consolidated": 0,
            "storage_status": "completed",
        }

    monkeypatch.setattr(
        uploads.sellout_ingestion.sellout_service,
        "load_clean_rows",
        load,
    )

    result = uploads.resolve_and_apply_mapping(
        "august.txt",
        _as_txt_bytes(dataframe),
        "gs://bucket/august.txt",
        replace_source=True,
    )

    assert captured == {
        "rows": 1,
        "replace_source": True,
        "period_type": "month",
    }
    assert result["processing"]["rows_stored"] == 1
    assert result["processing"]["storage_status"] == "completed"
