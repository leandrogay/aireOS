import datetime

import pandas as pd
import pytest

from app.services import forecast_service


class FakeJob:
    def __init__(self, df=None):
        self._df = df
        self.num_dml_affected_rows = 3

    def result(self):
        return self

    def to_dataframe(self):
        return self._df


class FakeBigQueryClient:
    """Answers each SELECT from a canned DataFrame and records loads, MERGEs and deletes."""

    def __init__(self, table_rows, sellout_weeks):
        self.table_rows = table_rows
        self.sellout_weeks = sellout_weeks
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
        if forecast_service.FORECAST_TABLE in query:
            return FakeJob(self.table_rows)
        return FakeJob(self.sellout_weeks)

    def load_table_from_dataframe(self, df, table, job_config=None):
        self.loads.append((table, df))
        return FakeJob()

    def delete_table(self, table, not_found_ok=False):
        self.deleted.append(table)

    def merges(self):
        return [query for query, _ in self.queries if query.lstrip().startswith("MERGE")]


def _table_rows():
    # Matches _sellout_weeks(): April has five Thursdays, May and June four.
    rows = []
    for month, units in (("2026-04", 125.0), ("2026-05", 100.0), ("2026-06", 100.0)):
        rows.append({"month_year": f"{month}-01", "forecast_generated_at": None, "customer_id": 1,
                     "customer_name": "fairprice", "product_name": "Aire Adult Pants L",
                     "promo_type": None, "promotion_mechanic": None, "period_label": None, "voucher": None,
                     "quantity_units": units, "revenue": units * 10,
                     "predicted_quantity_units": None, "predicted_revenue": None})
    rows.append({"month_year": "2026-07-01", "forecast_generated_at": "2026-06-30", "customer_id": 1,
                 "customer_name": "fairprice", "product_name": "Aire Adult Pants L",
                 "promo_type": "bundle", "promotion_mechanic": "Buy 2 Get 1 Free",
                 "period_label": "2026-M07", "voucher": "B2G1",
                 "quantity_units": None, "revenue": None,
                 "predicted_quantity_units": 650.0, "predicted_revenue": 9100.0})
    return pd.DataFrame(rows)


def _sellout_weeks():
    # Every Thursday from 2 Apr to 30 Jul 2026 -> April..July complete, 25 units a week.
    starts = pd.date_range("2026-04-02", "2026-07-30", freq="7D")
    return pd.DataFrame({"period_start": starts, "customer_name": "fairprice",
                         "product_name": "Aire Adult Pants L", "quantity_units": 25.0, "revenue": 250.0})


def _install_fake_client(monkeypatch, table_rows=None):
    fake = FakeBigQueryClient(table_rows if table_rows is not None else _table_rows(), _sellout_weeks())
    monkeypatch.setattr(forecast_service, "get_bigquery_client", lambda: fake)
    monkeypatch.setattr(
        forecast_service.catalog_service, "get_product_prices",
        lambda: {"Aire Adult Pants L": 14.0},
    )
    return fake


def _year_of_actuals(year, units=100.0, product="Aire Adult Pants L"):
    return [
        {"month_year": f"{year}-{month:02d}-01", "forecast_generated_at": None, "customer_id": 1,
         "customer_name": "fairprice", "product_name": product,
         "promo_type": None, "promotion_mechanic": None, "period_label": None, "voucher": None,
         "quantity_units": units, "revenue": units * 10.0,
         "predicted_quantity_units": None, "predicted_revenue": None}
        for month in range(1, 13)
    ]


def _no_client_allowed(monkeypatch):
    def _boom():
        raise AssertionError("get_bigquery_client should not be called")

    monkeypatch.setattr(forecast_service, "get_bigquery_client", _boom)


# ---- Validation happens before any BigQuery call ----------------------------

def test_negative_uplift_raises_without_querying(monkeypatch):
    _no_client_allowed(monkeypatch)
    with pytest.raises(ValueError):
        forecast_service.refresh_forecast(uplift_override={"bundle": -0.5})


# ---- Reads -------------------------------------------------------------------

def test_sellout_query_binds_customers_and_deduplicates(monkeypatch):
    fake = _install_fake_client(monkeypatch)

    forecast_service.get_sellout_weeks(["fairprice"])

    query, job_config = fake.queries[-1]
    params = {p.name: p for p in job_config.query_parameters}
    assert params["customers"].values == ["fairprice"]
    assert "SELECT DISTINCT" in query
    assert "QUALIFY loaded_at = MAX(loaded_at)" in query
    assert "period_type = 'week'" in query


# ---- Refresh -----------------------------------------------------------------

def test_preview_never_writes(monkeypatch):
    fake = _install_fake_client(monkeypatch)

    result = forecast_service.refresh_forecast(write=False)

    assert fake.loads == []
    assert fake.merges() == []
    assert result["written"] == {"actual_rows": 0, "forecast_rows": 0}


def test_new_complete_month_adds_actual_row_and_next_run(monkeypatch):
    _install_fake_client(monkeypatch)

    result = forecast_service.refresh_forecast(write=False)

    new_actuals = result["actual_changes"]
    assert new_actuals["month_year"].astype(str).tolist() == ["2026-07"]
    assert new_actuals["promo_type"].tolist() == ["bundle"]
    assert result["new_run"] == "2026-07-31"


def test_write_merges_actuals_then_forecast_and_drops_staging(monkeypatch):
    fake = _install_fake_client(monkeypatch)

    result = forecast_service.refresh_forecast(write=True)

    merges = fake.merges()
    assert len(merges) == 2
    assert "t.forecast_generated_at IS NULL" in merges[0]
    assert "predicted_quantity_units = s.predicted_quantity_units" in merges[1]
    # Heals a pre-migration NULL run_type/tier the next time that row is touched.
    assert "run_type = s.run_type" in merges[1]
    assert "tier = s.tier" in merges[1]
    assert sorted(fake.deleted) == sorted(table for table, _ in fake.loads)
    assert result["written"] == {"actual_rows": 3, "forecast_rows": 3}


def test_staging_table_is_dropped_when_merge_fails(monkeypatch):
    fake = _install_fake_client(monkeypatch)
    fake.fail_merge = True

    with pytest.raises(RuntimeError):
        forecast_service.refresh_forecast(write=True)

    assert fake.deleted == [fake.loads[0][0]]


def test_staging_frame_matches_bigquery_schema(monkeypatch):
    fake = _install_fake_client(monkeypatch)

    forecast_service.refresh_forecast(write=True)

    _, forecast_frame = fake.loads[-1]
    assert list(forecast_frame.columns) == [field.name for field in forecast_service._FORECAST_SCHEMA]
    assert str(forecast_frame["customer_id"].dtype) == "Int64"
    assert forecast_frame["month_year"].map(type).eq(pd.Timestamp("2026-01-01").date().__class__).all()


# ---- Yearly baseline -----------------------------------------------------------

def test_yearly_baseline_is_generated_once_prior_december_is_complete(monkeypatch):
    # A totally fresh table (no forecast rows at all yet) fires BOTH a rolling
    # run and a yearly baseline on the first refresh -- and since neither a
    # rolling nor a yearly run exists yet, both land on the same date and
    # target the exact same months. This is exactly the collision scenario
    # run_type exists to prevent: assert both survive as 24 distinct rows,
    # not 12 collided ones.
    fake = _install_fake_client(monkeypatch, table_rows=pd.DataFrame(_year_of_actuals(2025)))

    result = forecast_service.refresh_forecast(write=True, refresh_actuals=False)

    assert result["new_yearly_runs"] == ["2025-12-31"]
    assert result["new_run"] == "2025-12-31"
    forecast = result["forecast"]
    assert set(forecast["run_type"]) == {"rolling", "yearly"}
    yearly = forecast[forecast["run_type"] == "yearly"]
    rolling = forecast[forecast["run_type"] == "rolling"]
    assert len(yearly) == 12
    assert len(rolling) == 12
    assert str(yearly["month_year"].min()) == "2026-01"
    assert str(yearly["month_year"].max()) == "2026-12"
    assert set(yearly["month_year"]) == set(rolling["month_year"])

    merges = fake.merges()
    assert len(merges) == 1  # refresh_actuals=False -- only the forecast MERGE runs
    assert "COALESCE(t.run_type, 'rolling') = s.run_type" in merges[0]

    _, staged = fake.loads[-1]
    assert len(staged) == 24
    assert set(staged["run_type"]) == {"rolling", "yearly"}


def test_yearly_baseline_is_never_recomputed_once_written(monkeypatch):
    already_computed_yearly = [
        {"month_year": f"2026-{month:02d}-01", "forecast_generated_at": "2025-12-31", "run_type": "yearly",
         "customer_id": 1, "customer_name": "fairprice", "product_name": "Aire Adult Pants L",
         "promo_type": None, "promotion_mechanic": None, "period_label": None, "voucher": None,
         "quantity_units": None, "revenue": None,
         "predicted_quantity_units": 100.0, "predicted_revenue": 1400.0}
        for month in range(1, 13)
    ]
    fake = _install_fake_client(
        monkeypatch, table_rows=pd.DataFrame(_year_of_actuals(2025) + already_computed_yearly)
    )

    result = forecast_service.refresh_forecast(write=True, recompute_all=True, refresh_actuals=False)

    assert result["new_yearly_runs"] == []
    assert "yearly runs computed: none" in result["notes"]
    # A rolling run still fires (none exists yet in this fixture), but nothing
    # yearly should be part of what got (re)computed.
    assert "yearly" not in set(result["forecast"]["run_type"])


def test_yearly_backfill_adds_every_missing_year_in_one_run(monkeypatch):
    # Two full prior years of actuals, no yearly baseline at all yet -- both
    # 2026's and 2027's baselines should appear in this single refresh, not
    # require running the script twice.
    two_years = _year_of_actuals(2025) + _year_of_actuals(2026, units=120.0)
    fake = _install_fake_client(monkeypatch, table_rows=pd.DataFrame(two_years))

    result = forecast_service.refresh_forecast(write=True, refresh_actuals=False)

    assert result["new_yearly_runs"] == ["2025-12-31", "2026-12-31"]
    yearly = result["forecast"][result["forecast"]["run_type"] == "yearly"]
    assert set(yearly["forecast_generated_at"]) == {datetime.date(2025, 12, 31), datetime.date(2026, 12, 31)}
    assert len(yearly) == 24  # 12 months x 2 years for the one product


# ---- Tier 0 / Tier 1 -------------------------------------------------------------

def test_a_tier_1_row_is_never_recomputed_or_overwritten(monkeypatch):
    # A Tier 1 row (a teammate's model, not ours) shares this rolling run's
    # exact date/months/product/customer -- refresh_forecast must leave it
    # alone entirely: not recompute it, not fold it into the tier-0 output.
    tier_1_row = {
        "month_year": "2026-07-01", "forecast_generated_at": "2026-06-30", "run_type": "rolling", "tier": 1,
        "customer_id": 1, "customer_name": "fairprice", "product_name": "Aire Adult Pants L",
        "promo_type": None, "promotion_mechanic": None, "period_label": None, "voucher": None,
        "quantity_units": None, "revenue": None,
        "predicted_quantity_units": 999.0, "predicted_revenue": 13986.0,
    }
    fake = _install_fake_client(monkeypatch, table_rows=pd.concat([_table_rows(), pd.DataFrame([tier_1_row])],
                                                                   ignore_index=True))

    result = forecast_service.refresh_forecast(write=True, recompute_all=True)

    assert set(result["forecast"]["tier"]) == {0}
    assert 999.0 not in result["forecast"]["predicted_quantity_units"].tolist()

    _, staged = fake.loads[-1]
    assert set(staged["tier"]) == {0}
    assert str(staged["tier"].dtype) == "Int64"
