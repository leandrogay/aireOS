-- Phase 3 repository proposal: copy verified Tier 0 components into the
-- current output table. Read/write SQL for the pipeline owner; not executed.
--
-- Run only after:
--   1. the output columns from phase-2_tier0_components_validation.sql exist;
--   2. run_tier0_legacy has written the component columns; and
--   3. the phase-2 parity query has been adapted/run against the new output.
--
-- The source is restricted to tier0_legacy and the current timestamp. It
-- cannot overwrite Tier 1 rows or components from an older run.

MERGE `aire-data.aireos_forecast_validation_sg.aire_forecasting_output` AS output
USING (
  SELECT
    r.forecast_generated_at,
    r.customer_id,
    r.sku,
    r.month_year,
    r.tier0_latest_month,
    r.tier0_ly_cartons,
    r.tier0_run_rate,
    r.tier0_growth,
    r.tier0_base_method,
    r.tier0_sell_out_base,
    r.tier0_recent_months
  FROM `aire-data.aireos_forecast_validation_sg.aire_forecasting_runs` r
  WHERE r.source_model = 'tier0_legacy'
    AND r.forecast_generated_at = (
      SELECT MAX(current_generated_at)
      FROM `aire-data.aireos_forecast_validation_sg.aire_forecasting_output`
      WHERE tier = 'tier0'
    )
) AS run
ON output.tier = 'tier0'
AND output.current_generated_at = run.forecast_generated_at
AND output.customer_id = run.customer_id
AND output.sku = run.sku
AND output.month_year = run.month_year
WHEN MATCHED THEN UPDATE SET
  tier0_latest_month = run.tier0_latest_month,
  tier0_ly_cartons = run.tier0_ly_cartons,
  tier0_run_rate = run.tier0_run_rate,
  tier0_growth = run.tier0_growth,
  tier0_base_method = run.tier0_base_method,
  tier0_sell_out_base = run.tier0_sell_out_base,
  tier0_recent_months = run.tier0_recent_months;
