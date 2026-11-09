-- Phase 2: persist Tier 0 component provenance in the validation dataset.
--
-- This file is a deployment proposal for the pipeline owner. It is not run by
-- the application and has not been executed against BigQuery.
--
-- Project: aire-data
-- Dataset: aireos_forecast_validation_sg
-- Required follow-up: update the live run_tier0_legacy INSERT and the output
-- rebuild SELECT so these columns are copied from the latest Tier 0 rows.

-- 1. Add nullable provenance columns. Existing rows remain valid and NULL.
ALTER TABLE `aire-data.aireos_forecast_validation_sg.aire_forecasting_runs`
  ADD COLUMN IF NOT EXISTS tier0_latest_month DATE,
  ADD COLUMN IF NOT EXISTS tier0_ly_cartons FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_run_rate FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_growth FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_base_method STRING,
  ADD COLUMN IF NOT EXISTS tier0_sell_out_base FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_recent_months ARRAY<DATE>;

ALTER TABLE `aire-data.aireos_forecast_validation_sg.aire_forecasting_output`
  ADD COLUMN IF NOT EXISTS tier0_latest_month DATE,
  ADD COLUMN IF NOT EXISTS tier0_ly_cartons FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_run_rate FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_growth FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_base_method STRING,
  ADD COLUMN IF NOT EXISTS tier0_sell_out_base FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_recent_months ARRAY<DATE>;

-- The monthly pipeline archives run rows with INSERT ... SELECT *, so the
-- archive must have the same columns before the procedure is deployed.
ALTER TABLE `aire-data.aireos_forecast_validation_sg.aire_forecasting_archive`
  ADD COLUMN IF NOT EXISTS tier0_latest_month DATE,
  ADD COLUMN IF NOT EXISTS tier0_ly_cartons FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_run_rate FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_growth FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_base_method STRING,
  ADD COLUMN IF NOT EXISTS tier0_sell_out_base FLOAT64,
  ADD COLUMN IF NOT EXISTS tier0_recent_months ARRAY<DATE>;

-- 2. In run_tier0_legacy, extend the forecast INSERT column list with:
--
--   tier0_latest_month, tier0_ly_cartons, tier0_run_rate, tier0_growth,
--   tier0_base_method, tier0_sell_out_base, tier0_recent_months
--
-- and select the corresponding columns from the latest rows. The live view
-- currently exposes latest_month, run_rate, base_method and sell_out_base.
-- It does not expose growth, so tier0_growth must be NULL until the pipeline
-- implements and persists a real growth calculation.
--
-- The view must also expose:
--
--   ARRAY_AGG(
--     IF(k.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH),
--        k.month_year, NULL)
--     IGNORE NULLS ORDER BY k.month_year
--   ) AS recent_months
--
-- from the same per-series window used by run_rate. Do not derive this list
-- from a global latest month.

-- 3. Rebuild the application output with the same seven columns copied from
-- the tier0_legacy run rows. The output must retain the run's source_model
-- and current_generated_at, so the component values remain tied to the exact
-- forecast run.
