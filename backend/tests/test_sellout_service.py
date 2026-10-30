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


def _fake_database(unowned=()):
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value

    def execute(statement, parameters=None):
        result = MagicMock()
        sql = str(statement)
        if "customer_retailers" in sql:
            owned = [
                name for name in parameters["retailer_names"] if name not in unowned
            ]
            result.scalars.return_value.all.return_value = owned
        elif "RETURNING" in sql and "retailer_name" in sql:
            result.all.return_value = [("fairprice_offline", 7)]
        elif "RETURNING" in sql and "store_code" in sql:
            result.all.return_value = [(7, "420", 42)]
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
        call
        for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    assert len(fact_call.args[1]) == 2
    assert all(fact["loaded_at"] == timestamp for fact in fact_call.args[1])
    assert all(
        fact["data_source"] == "aireos_upload" for fact in fact_call.args[1]
    )
    assert not any("DELETE FROM sellout" in sql for sql in sql_calls)


def test_a_retailer_no_customer_owns_is_rejected_without_writing_anything():
    engine, connection = _fake_database(unowned={"fairprice_offline"})

    with pytest.raises(sellout_service.SelloutLoadError, match="No customer owns fairprice_offline"):
        sellout_service.load_clean_rows(_dataframe(), engine=engine)

    sql_calls = [str(call.args[0]) for call in connection.execute.call_args_list]
    assert not any("INSERT INTO" in sql for sql in sql_calls)


def test_master_references_delegate_to_shared_catalog_helpers(monkeypatch):
    retailer_helper = MagicMock(return_value={"fairprice_offline": 7})
    store_helper = MagicMock(return_value=[42])
    monkeypatch.setattr(
        sellout_service.catalog_service,
        "get_or_create_retailers",
        retailer_helper,
    )
    monkeypatch.setattr(
        sellout_service.catalog_service,
        "get_or_create_stores",
        store_helper,
    )
    engine, connection = _fake_database()

    sellout_service.load_clean_rows(_dataframe(), engine=engine)

    retailer_helper.assert_called_once_with(connection, ["fairprice_offline"])
    store_helper.assert_called_once_with(
        connection,
        [
            {
                "retailer_id": 7,
                "store_code": "420",
                "store_name": "AMK Hypermart",
                "store_format": "HYPER",
            }
        ],
    )


def test_customer_level_rows_use_an_explicit_all_stores_database_key(monkeypatch):
    dataframe = _dataframe().iloc[[0]].copy()
    dataframe.loc[:, "retailer"] = "nhg_offline"
    dataframe.loc[:, "store_code"] = None
    dataframe.loc[:, "store_name"] = None
    retailer_helper = MagicMock(return_value={"nhg_offline": 8})
    store_helper = MagicMock(return_value=[99])
    monkeypatch.setattr(
        sellout_service.catalog_service,
        "get_or_create_retailers",
        retailer_helper,
    )
    monkeypatch.setattr(
        sellout_service.catalog_service,
        "get_or_create_stores",
        store_helper,
    )
    engine, connection = _fake_database()

    sellout_service.load_clean_rows(dataframe, engine=engine)

    store_helper.assert_called_once_with(
        connection,
        [{
            "retailer_id": 8,
            "store_code": sellout_service.ALL_STORES_CODE,
            "store_name": sellout_service.ALL_STORES_NAME,
            "store_format": "HYPER",
        }],
    )
    fact_call = next(
        call
        for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    assert fact_call.args[1][0]["store_code"] == sellout_service.ALL_STORES_CODE


def test_reload_deletes_only_stale_keys_returned_by_the_ingestion_run(monkeypatch):
    engine, connection = _fake_database()
    timestamp = datetime.datetime(2026, 9, 6, tzinfo=datetime.timezone.utc)
    stale = {
        "retailer_id": 7,
        "store_code": "420",
        "sku": "13255043",
        "period_start": datetime.date(2025, 12, 1),
        "period_type": "month",
    }
    monkeypatch.setattr(
        sellout_service.ingestion_service,
        "start_run",
        MagicMock(return_value=42),
    )
    monkeypatch.setattr(
        sellout_service.ingestion_service,
        "record_versions",
        MagicMock(return_value=[stale]),
    )
    monkeypatch.setattr(
        sellout_service.ingestion_service,
        "complete_run",
        MagicMock(),
    )

    sellout_service.load_clean_rows(
        _dataframe(),
        replace_source=True,
        source_blob="uploads/2026-10-29_monthly.txt",
        loaded_at=timestamp,
        engine=engine,
    )

    sql_calls = [str(call.args[0]) for call in connection.execute.call_args_list]
    delete_index = next(
        index for index, sql in enumerate(sql_calls) if "DELETE FROM sellout" in sql
    )
    insert_index = next(
        index for index, sql in enumerate(sql_calls) if "INSERT INTO sellout" in sql
    )
    assert delete_index < insert_index
    assert sum("DELETE FROM sellout" in sql for sql in sql_calls) == 1
    delete_call = next(
        call
        for call in connection.execute.call_args_list
        if "DELETE FROM sellout" in str(call.args[0])
    )
    assert delete_call.args[1] == [{
        "retailer_id": 7,
        "store_code": "420",
        "sku": "13255043",
        "period_start": datetime.date(2025, 12, 1),
        "period_type": "month",
    }]


def test_replace_source_without_a_unique_blob_is_rejected():
    engine, connection = _fake_database()

    try:
        sellout_service.load_clean_rows(
            _dataframe(),
            replace_source=True,
            engine=engine,
        )
    except ValueError as exc:
        assert str(exc) == "replace_source requires a unique source_blob"
    else:
        raise AssertionError("A filename-only replacement must be rejected")

    engine.begin.assert_not_called()


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
        call
        for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    sku_call = next(
        call
        for call in connection.execute.call_args_list
        if "INSERT INTO skus" in str(call.args[0])
    )
    assert result["rows_stored"] == 1
    assert result["rows_consolidated"] == 1
    assert sellout_call.args[1][0]["quantity_units"] == 31.0
    assert sellout_call.args[1][0]["revenue"] == 290.18
    assert sku_call.args[1]["uom"] == "EA"


def test_dry_run_summary_matches_database_consolidation():
    dataframe = _dataframe().iloc[[0]].copy()
    carton = dataframe.iloc[0].to_dict()
    carton.update({"uom": "CAR", "quantity_units": 16.0, "revenue": 148.44})
    each = dataframe.iloc[0].to_dict()
    each.update({"uom": "EA", "quantity_units": 15.0, "revenue": 141.74})

    summary = sellout_service.summarize_clean_rows(pd.DataFrame([carton, each]))

    assert summary == {
        "rows_input": 2,
        "rows_stored": 1,
        "rows_consolidated": 1,
        "retailers": {"fairprice_offline": 1},
        "sku_count": 1,
        "first_period": datetime.date(2026, 1, 1),
        "last_period": datetime.date(2026, 1, 1),
    }


def test_historical_import_can_preserve_source_lineage():
    engine, connection = _fake_database()

    sellout_service.load_clean_rows(
        _dataframe(),
        data_source="pipeline",
        engine=engine,
    )

    fact_call = next(
        call
        for call in connection.execute.call_args_list
        if "INSERT INTO sellout" in str(call.args[0])
    )
    assert all(fact["data_source"] == "pipeline" for fact in fact_call.args[1])


def test_uploaded_rows_are_versioned_in_the_same_transaction(monkeypatch):
    engine, connection = _fake_database()
    start = MagicMock(return_value=42)
    record = MagicMock(return_value=[])
    complete = MagicMock()
    monkeypatch.setattr(sellout_service.ingestion_service, "start_run", start)
    monkeypatch.setattr(sellout_service.ingestion_service, "record_versions", record)
    monkeypatch.setattr(sellout_service.ingestion_service, "complete_run", complete)

    result = sellout_service.load_clean_rows(
        _dataframe(),
        source_blob="uploads/2026-10-27_monthly.txt",
        content_hash="abc123",
        mapping_fingerprint="mapping123",
        engine=engine,
    )

    assert result["ingestion_id"] == 42
    start.assert_called_once_with(
        connection,
        source_blob="uploads/2026-10-27_monthly.txt",
        source_file="monthly.txt",
        content_hash="abc123",
        mapping_fingerprint="mapping123",
        loaded_at=start.call_args.kwargs["loaded_at"],
    )
    record.assert_called_once()
    assert record.call_args.args[0:2] == (connection, 42)
    assert len(record.call_args.args[2]) == 2
    complete.assert_called_once_with(
        connection,
        42,
        rows_stored=2,
        rows_consolidated=0,
    )


def test_large_loads_use_batched_multi_row_upserts():
    connection = MagicMock()
    timestamp = datetime.datetime(2026, 9, 24, tzinfo=datetime.timezone.utc)
    records = [
        {
            "retailer_id": 57,
            "period_start": datetime.date(2026, 1, 1),
            "period_end": datetime.date(2026, 1, 31),
            "period_type": "month",
            "store_code": str(index),
            "sku": "13255043",
            "quantity_units": float(index),
            "revenue": float(index * 10),
            "source_file": "history.xlsx",
            "loaded_at": timestamp,
            "data_source": "pipeline",
        }
        for index in range(501)
    ]

    sellout_service._upsert_sellout(connection, records)

    assert connection.execute.call_count == 2
    first_sql = str(connection.execute.call_args_list[0].args[0])
    first_parameters = connection.execute.call_args_list[0].args[1]
    second_parameters = connection.execute.call_args_list[1].args[1]
    assert ":retailer_id_0" in first_sql
    assert ":retailer_id_499" in first_sql
    assert first_parameters["store_code_499"] == "499"
    assert second_parameters["store_code_0"] == "500"
