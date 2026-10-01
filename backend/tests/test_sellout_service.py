import datetime
from unittest.mock import MagicMock

import pandas as pd
import pytest

from app.services import sellout_service


def _dataframe():
    return pd.DataFrame(
        [
            {
                "retailer": "fairprice_offline",
                "store_code": "420",
                "store_name": "AMK Hypermart",
                "store_format": "HYPER",
                "sku": "13255043",
                "product_name": "Aire Adult Pants XL",
                "sku_range": "Aire Adult Diaper Pants",
                "size": "XL",
                "brand": "AIRE",
                "product_category": "Adult Diaper Pants",
                "uom": "EA",
                "pack_size": 8,
                "period_start": "2026-08-01",
                "period_end": "2026-08-31",
                "period_type": "month",
                "quantity_units": 10.0,
                "revenue": 100.0,
                "source_file": "august.txt",
            }
        ]
    )


def _database(monkeypatch):
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    monkeypatch.setattr(
        sellout_service.catalog_service,
        "get_or_create_retailers",
        MagicMock(return_value={"fairprice_offline": 57}),
    )
    monkeypatch.setattr(
        sellout_service.catalog_service,
        "get_or_create_stores",
        MagicMock(return_value=[420]),
    )
    return engine, connection


def test_load_protects_existing_sku_master_and_upserts_sellout(monkeypatch):
    engine, connection = _database(monkeypatch)
    timestamp = datetime.datetime(2026, 10, 1, tzinfo=datetime.timezone.utc)

    result = sellout_service.load_clean_rows(
        _dataframe(), engine=engine, loaded_at=timestamp
    )

    sql_calls = [str(call.args[0]) for call in connection.execute.call_args_list]
    sku_sql = next(sql for sql in sql_calls if "INSERT INTO skus" in sql)
    assert "ON CONFLICT (sku)" in sku_sql
    assert "DO NOTHING" in sku_sql
    assert "DO UPDATE" not in sku_sql
    assert sum("INSERT INTO sellout" in sql for sql in sql_calls) == 1

    fact_call = next(
        call
        for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    assert fact_call.args[1][0]["loaded_at"] == timestamp
    assert fact_call.args[1][0]["data_source"] == "aireos_upload"
    assert result == {
        "rows_stored": 1,
        "rows_consolidated": 0,
        "storage_status": "completed",
    }


def test_force_replacement_deletes_source_inside_same_transaction(monkeypatch):
    engine, connection = _database(monkeypatch)

    sellout_service.load_clean_rows(
        _dataframe(), replace_source=True, engine=engine
    )

    sql_calls = [str(call.args[0]) for call in connection.execute.call_args_list]
    delete_index = next(
        index for index, sql in enumerate(sql_calls) if "DELETE FROM sellout" in sql
    )
    insert_index = next(
        index for index, sql in enumerate(sql_calls) if "INSERT INTO sellout" in sql
    )
    assert delete_index < insert_index


def test_duplicate_business_rows_are_consolidated(monkeypatch):
    row = _dataframe().iloc[0].to_dict()
    carton = {**row, "uom": "CAR", "quantity_units": 16.0, "revenue": 148.44}
    each = {**row, "uom": "EA", "quantity_units": 15.0, "revenue": 141.74}
    engine, connection = _database(monkeypatch)

    result = sellout_service.load_clean_rows(
        pd.DataFrame([carton, each]), engine=engine
    )

    fact_call = next(
        call
        for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    assert result["rows_stored"] == 1
    assert result["rows_consolidated"] == 1
    assert fact_call.args[1][0]["quantity_units"] == 31.0
    assert fact_call.args[1][0]["revenue"] == 290.18


def test_database_failure_is_wrapped(monkeypatch):
    engine = MagicMock()
    engine.begin.side_effect = RuntimeError("database unavailable")

    with pytest.raises(sellout_service.SelloutLoadError, match="database unavailable"):
        sellout_service.load_clean_rows(_dataframe(), engine=engine)
