-- Paste in BigQuery (aire-data / Aire_Data).
-- Swap later via .env.backend BQ_FORECAST_TABLE only.
-- customer_name is the combined retailer family (fairprice_offline +
-- fairprice_online → fairprice). Promo columns are null when the month
-- has no promotion. Forecasted revenue is priced from Postgres skus.price
-- (see catalog_service.get_product_prices), not a BigQuery price table.
--
-- run_type distinguishes the two kinds of forecast row (actual rows, where
-- forecast_generated_at IS NULL, don't use it):
--   'rolling'  the existing 12-months-ahead forecast, one new run per
--              complete actual month (pl_forecast.next_run).
--   'yearly'   a frozen Jan-Dec baseline for one calendar year, generated
--              once using only actual data through Dec of the prior year,
--              and never recomputed after that (pl_forecast.next_yearly_run).
-- A rolling run and a yearly run can land on the exact same
-- forecast_generated_at date and target the exact same months for the same
-- product/customer (e.g. both dated 2025-12-31, both covering Jan-Dec 2026)
-- -- run_type is what keeps those two logically distinct rows from
-- colliding, both in this table's natural key and in the MERGE below.
--
-- tier distinguishes which model produced a predicted row (actual rows
-- don't use it either):
--   0  this app's own pl_forecast.py model -- always fully populated.
--   1  a teammate's separate model, populated by a process outside this
--      app (not yet built). The Forecast page's Tier 1 view shows a Tier 1
--      value where one exists for a cell and falls back to Tier 0
--      otherwise (frontend forecastView.resolveTier) -- simple presence
--      fallback, no accuracy tracking.
-- A Tier 1 row can share the exact same forecast_generated_at/run_type/
-- month/product/customer as a Tier 0 row for the same cell -- that's the
-- point, so the two can be compared -- so tier joins run_type in this
-- table's natural key and the MERGE below, the same way run_type keeps
-- rolling and yearly apart.
--
-- One-time migrations for the already-populated live table:
--   ALTER TABLE `aire-data.Aire_Data.forecasting_output_xianhui_mock`
--   ADD COLUMN run_type STRING;
--   ALTER TABLE `aire-data.Aire_Data.forecasting_output_xianhui_mock`
--   ADD COLUMN tier INT64;
-- Existing rows get NULL, which app code treats as 'rolling' / 0
-- everywhere (see pl_forecast.normalise_rows) -- no backfill required.

CREATE TABLE `aire-data.Aire_Data.forecasting_output_xianhui_mock` (
  month_year DATE NOT NULL,
  forecast_generated_at DATE,
  run_type STRING,
  tier INT64,
  customer_id INT64 NOT NULL,
  customer_name STRING NOT NULL,
  product_name STRING NOT NULL,
  promo_type STRING,
  promotion_mechanic STRING,
  period_label STRING,
  voucher STRING,
  quantity_units FLOAT64,
  predicted_quantity_units FLOAT64,
  revenue FLOAT64,
  predicted_revenue FLOAT64
);
