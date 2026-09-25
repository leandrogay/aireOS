import pandas as pd
import pytest

from app.services import forecast_service


class FakeJob:
    def __init__(self, df=None):
        self._df = df
        self.num_dml_affected_rows = 2

    def result(self):
        return self

    def to_dataframe(self):
        return self._df


class FakeBigQueryClient:
    """Routes SELECTs to canned DataFrames by table name; records loads/merges/deletes."""

    def __init__(self, inventory_rows, forecast_rows):
        self.inventory_rows = inventory_rows
        self.forecast_rows = forecast_rows
        self.queries = []
        self.loads = []
        self.deleted = []
        self.fail_merge = False

    def query(self, query, job_config=None):
        self.queries.append((query, job_config))
        if query.lstrip().startswith("MERGE"):
            if self.fail_merge:
                raise RuntimeError("merge failed")
            return FakeJob()
        if forecast_service.INVENTORY_METRICS_TABLE in query:
            return FakeJob(self.inventory_rows)
        return FakeJob(self.forecast_rows)

    def load_table_from_dataframe(self, df, table, job_config=None):
        self.loads.append((table, df))
        return FakeJob()

    def delete_table(self, table, not_found_ok=False):
        self.deleted.append(table)

    def merges(self):
        return [query for query, _ in self.queries if query.lstrip().startswith("MERGE")]


def _inventory_metric(sku, customer_id, month, metric_name, value, value_type):
    return {
        "sku": sku, "customer_id": customer_id, "period_start": f"{month}-01",
        "metric_name": metric_name, "metric_value": value, "value_type": value_type,
    }


def _inventory_rows():
    return pd.DataFrame([
        _inventory_metric("111", 1, "2026-06", "opening_inventory", 100.0, "derived"),
        _inventory_metric("111", 1, "2026-06", "sell_in", 50.0, "actual"),
        _inventory_metric("111", 1, "2026-06", "sell_out_base", 40.0, "actual"),
    ])


def _forecast_actual(month, units):
    return {"month_year": f"{month}-01", "forecast_generated_at": None, "customer_id": 1,
            "customer_name": "fairprice", "product_name": "Widget",
            "promo_type": None, "promotion_mechanic": None, "period_label": None, "voucher": None,
            "quantity_units": units, "revenue": units * 10,
            "predicted_quantity_units": None, "predicted_revenue": None}


def _forecast_rows():
    # Flat 40 units/month so run-rate forecasting is exact and easy to hand-check.
    return pd.DataFrame([_forecast_actual(m, 40.0) for m in ("2026-04", "2026-05", "2026-06")])


def _install_fake_client(monkeypatch, inventory_rows=None, forecast_rows=None):
    fake = FakeBigQueryClient(
        inventory_rows if inventory_rows is not None else _inventory_rows(),
        forecast_rows if forecast_rows is not None else _forecast_rows(),
    )
    monkeypatch.setattr(forecast_service, "get_bigquery_client", lambda: fake)
    return fake


def _stub_bridges(monkeypatch, skus=None, customers=None):
    monkeypatch.setattr(
        forecast_service.catalog_service, "get_product_names_for_skus",
        lambda codes: skus if skus is not None else {"111": "Widget"},
    )
    monkeypatch.setattr(
        forecast_service.customer_service, "get_customer_names",
        lambda ids: customers if customers is not None else {1: "fairprice"},
    )


# ---- Reads -----------------------------------------------------------------------


def test_get_inventory_metrics_rows_queries_the_table(monkeypatch):
    fake = _install_fake_client(monkeypatch)

    df = forecast_service.get_inventory_metrics_rows()

    assert forecast_service.INVENTORY_METRICS_TABLE in fake.queries[0][0]
    assert len(df) == len(_inventory_rows())


# ---- refresh_inventory_position: preview ------------------------------------------


def test_preview_never_writes(monkeypatch):
    fake = _install_fake_client(monkeypatch)
    _stub_bridges(monkeypatch)

    result = forecast_service.refresh_inventory_position(write=False)

    assert fake.loads == []
    assert fake.merges() == []
    assert result["written"] == {"inventory_rows": 0}


def test_known_month_produces_actual_closing_and_horizon_rolls_forward(monkeypatch):
    _install_fake_client(monkeypatch)
    _stub_bridges(monkeypatch)

    result = forecast_service.refresh_inventory_position(
        write=False, inventory_params=forecast_service.inventory_forecast.InventoryParams(horizon_months=2)
    )
    positions = result["positions"].set_index("month_year")

    june = positions.loc[pd.Period("2026-06", "M")]
    assert june["actual_closing_inventory"] == 110.0  # 100 opening + 50 sell-in - 40 sell-out
    assert june["inventory_position"] == 110.0

    july = positions.loc[pd.Period("2026-07", "M")]
    assert pd.isna(july["actual_closing_inventory"])
    assert july["opening_inventory"] == 110.0  # carried from June
    assert july["forecast_sell_out"] == 40.0  # flat run-rate from pl_forecast
    assert july["predicted_closing_inventory"] == 70.0  # 110 + 0 recommended - 40 forecast


def test_rows_with_unresolved_sku_or_customer_produce_no_positions(monkeypatch):
    _install_fake_client(monkeypatch)
    _stub_bridges(monkeypatch, skus={}, customers={})

    result = forecast_service.refresh_inventory_position(write=False)

    assert result["positions"].empty
    assert result["written"] == {"inventory_rows": 0}
    assert any("no inventory_metrics rows resolved" in note for note in result["notes"])


def test_empty_inventory_metrics_table_short_circuits(monkeypatch):
    fake = _install_fake_client(monkeypatch, inventory_rows=pd.DataFrame())
    _stub_bridges(monkeypatch)

    result = forecast_service.refresh_inventory_position(write=False)

    assert result["positions"].empty
    assert fake.queries  # inventory_metrics was still queried once
    assert any("no rows in" in note for note in result["notes"])


# ---- refresh_inventory_position: write --------------------------------------------


def test_write_merges_positions_and_drops_staging(monkeypatch):
    fake = _install_fake_client(monkeypatch)
    _stub_bridges(monkeypatch)

    result = forecast_service.refresh_inventory_position(write=True)

    merges = fake.merges()
    assert len(merges) == 1
    assert "t.month_year = s.month_year" in merges[0]
    assert sorted(fake.deleted) == sorted(table for table, _ in fake.loads)
    assert result["written"]["inventory_rows"] == 2  # FakeJob.num_dml_affected_rows


def test_staging_frame_matches_bigquery_schema_and_backfills_customer_id(monkeypatch):
    fake = _install_fake_client(monkeypatch)
    _stub_bridges(monkeypatch)

    forecast_service.refresh_inventory_position(write=True)

    _, staged = fake.loads[-1]
    assert list(staged.columns) == [field.name for field in forecast_service._INVENTORY_SCHEMA]
    assert (staged["customer_id"] == 1).all()
    assert str(staged["customer_id"].dtype) == "Int64"


def test_staging_table_is_dropped_when_merge_fails(monkeypatch):
    fake = _install_fake_client(monkeypatch)
    fake.fail_merge = True
    _stub_bridges(monkeypatch)

    with pytest.raises(RuntimeError):
        forecast_service.refresh_inventory_position(write=True)

    assert fake.deleted == [fake.loads[0][0]]
