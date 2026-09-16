import datetime
from unittest.mock import MagicMock

import pandas as pd

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
                "period_start": "2026-01-01",
                "period_end": "2026-01-31",
                "period_type": "month",
                "quantity_units": 10.0,
                "revenue": 100.0,
                "source_file": "monthly.txt",
            },
            {
                "retailer": "fairprice_offline",
                "store_code": "420",
                "store_name": "AMK Hypermart",
                "store_format": "HYPER",
                "sku": "13255043",
                "period_start": "2026-02-01",
                "period_end": "2026-02-28",
                "period_type": "month",
                "quantity_units": 20.0,
                "revenue": 200.0,
                "source_file": "monthly.txt",
            },
        ]
    )


def _fake_database():
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value

    def execute(statement, parameters=None):
        result = MagicMock()
        if "RETURNING retailer_id" in str(statement):
            result.scalar_one.return_value = 7
        return result

    connection.execute.side_effect = execute
    return engine, connection


def test_load_clean_rows_reuses_master_rows_and_upserts_each_fact():
    engine, connection = _fake_database()
    timestamp = datetime.datetime(2026, 9, 6, tzinfo=datetime.timezone.utc)

    result = sellout_service.load_clean_rows(
        _dataframe(), engine=engine, loaded_at=timestamp
    )

    sql_calls = [str(call.args[0]) for call in connection.execute.call_args_list]
    assert result == {
        "rows_stored": 2,
        "rows_consolidated": 0,
        "storage_status": "completed",
    }
    assert sum("INSERT INTO retailers" in sql for sql in sql_calls) == 1
    assert sum("INSERT INTO stores" in sql for sql in sql_calls) == 1
    store_sql = next(sql for sql in sql_calls if "INSERT INTO stores" in sql)
    assert "store_name = stores.store_name" in store_sql
    assert "stores.store_format," in store_sql
    assert sum("INSERT INTO skus" in sql for sql in sql_calls) == 1
    assert not any("product_category" in sql for sql in sql_calls)
    sku_sql = next(sql for sql in sql_calls if "INSERT INTO skus" in sql)
    assert "ON CONFLICT (sku)" in sku_sql
    assert "DO NOTHING" in sku_sql
    assert "DO UPDATE" not in sku_sql
    assert sum("INSERT INTO sellout" in sql for sql in sql_calls) == 1
    fact_call = next(
        call for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    assert len(fact_call.args[1]) == 2
    assert all(fact["loaded_at"] == timestamp for fact in fact_call.args[1])
    assert not any("DELETE FROM sellout" in sql for sql in sql_calls)


def test_master_references_delegate_to_shared_catalog_helpers(monkeypatch):
    retailer_helper = MagicMock(return_value=7)
    store_helper = MagicMock(return_value=42)
    monkeypatch.setattr(sellout_service.catalog_service, "get_or_create_retailer", retailer_helper)
    monkeypatch.setattr(sellout_service.catalog_service, "get_or_create_store", store_helper)
    engine, connection = _fake_database()

    sellout_service.load_clean_rows(_dataframe(), engine=engine)

    retailer_helper.assert_called_once_with(connection, "fairprice_offline")
    store_helper.assert_called_once_with(connection, 7, "AMK Hypermart", "420", "HYPER")


def test_replacement_deletes_old_source_rows_inside_same_transaction():
    engine, connection = _fake_database()

    sellout_service.load_clean_rows(_dataframe(), replace_source=True, engine=engine)

    sql_calls = [str(call.args[0]) for call in connection.execute.call_args_list]
    delete_index = next(i for i, sql in enumerate(sql_calls) if "DELETE FROM sellout" in sql)
    insert_index = next(i for i, sql in enumerate(sql_calls) if "INSERT INTO sellout" in sql)
    assert delete_index < insert_index
    assert sum("DELETE FROM sellout" in sql for sql in sql_calls) == 1


def test_empty_dataframe_does_not_open_database_transaction():
    engine = MagicMock()

    result = sellout_service.load_clean_rows(pd.DataFrame(), engine=engine)

    assert result == {
        "rows_stored": 0,
        "rows_consolidated": 0,
        "storage_status": "completed",
    }
    engine.begin.assert_not_called()


def test_database_failure_is_reported_as_sellout_load_error():
    engine = MagicMock()
    engine.begin.side_effect = RuntimeError("database unavailable")

    try:
        sellout_service.load_clean_rows(_dataframe(), engine=engine)
    except sellout_service.SelloutLoadError as exc:
        assert "database unavailable" in str(exc)
    else:
        raise AssertionError("SelloutLoadError was not raised")


def test_same_business_key_is_summed_instead_of_overwritten():
    dataframe = _dataframe().iloc[[0]].copy()
    carton = dataframe.iloc[0].to_dict()
    carton.update({"uom": "CAR", "quantity_units": 16.0, "revenue": 148.44})
    each = dataframe.iloc[0].to_dict()
    each.update({"uom": "EA", "quantity_units": 15.0, "revenue": 141.74})
    engine, connection = _fake_database()

    result = sellout_service.load_clean_rows(
        pd.DataFrame([carton, each]), engine=engine
    )

    sellout_call = next(
        call for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    sku_call = next(
        call for call in connection.execute.call_args_list
        if "INSERT INTO skus" in str(call.args[0])
    )
    assert result["rows_stored"] == 1
    assert result["rows_consolidated"] == 1
    assert sellout_call.args[1][0]["quantity_units"] == 31.0
    assert sellout_call.args[1][0]["revenue"] == 290.18
    assert sku_call.args[1]["uom"] == "EA"
