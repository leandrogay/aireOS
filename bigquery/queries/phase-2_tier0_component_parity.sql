-- Phase 2 parity check. Read-only.
--
-- Compare the Tier 0 component values persisted in the run table with the
-- values exposed by the application output. Run this after the pipeline owner
-- deploys the component columns and rebuilds one forecast.

WITH current_output AS (
  SELECT MAX(current_generated_at) AS forecast_generated_at
  FROM `aire-data.aireos_forecast_validation_sg.aire_forecasting_output`
  WHERE tier = 'tier0'
),
run_rows AS (
  SELECT
    forecast_generated_at,
    source_model,
    customer_id,
    sku,
    month_year,
    tier0_latest_month,
    tier0_ly_cartons,
    tier0_run_rate,
    tier0_growth,
    tier0_base_method,
    tier0_sell_out_base,
    tier0_recent_months
  FROM `aire-data.aireos_forecast_validation_sg.aire_forecasting_runs`
  WHERE source_model = 'tier0_legacy'
    AND forecast_generated_at = (SELECT forecast_generated_at FROM current_output)
),
output_rows AS (
  SELECT
    current_generated_at AS forecast_generated_at,
    current_source_model AS source_model,
    customer_id,
    sku,
    month_year,
    tier0_latest_month,
    tier0_ly_cartons,
    tier0_run_rate,
    tier0_growth,
    tier0_base_method,
    tier0_sell_out_base,
    tier0_recent_months
  FROM `aire-data.aireos_forecast_validation_sg.aire_forecasting_output`
  WHERE tier = 'tier0'
    AND current_generated_at = (SELECT forecast_generated_at FROM current_output)
)
SELECT
  COALESCE(r.forecast_generated_at, o.forecast_generated_at) AS forecast_generated_at,
  COALESCE(r.source_model, o.source_model) AS source_model,
  COALESCE(r.customer_id, o.customer_id) AS customer_id,
  COALESCE(r.sku, o.sku) AS sku,
  COALESCE(r.month_year, o.month_year) AS month_year,
  CASE
    WHEN r.forecast_generated_at IS NULL THEN 'missing_run_row'
    WHEN o.forecast_generated_at IS NULL THEN 'missing_output_row'
    WHEN r.tier0_latest_month IS DISTINCT FROM o.tier0_latest_month
      OR r.tier0_ly_cartons IS DISTINCT FROM o.tier0_ly_cartons
      OR r.tier0_run_rate IS DISTINCT FROM o.tier0_run_rate
      OR r.tier0_growth IS DISTINCT FROM o.tier0_growth
      OR r.tier0_base_method IS DISTINCT FROM o.tier0_base_method
      OR r.tier0_sell_out_base IS DISTINCT FROM o.tier0_sell_out_base
      OR r.tier0_recent_months IS DISTINCT FROM o.tier0_recent_months
      THEN 'component_mismatch'
    ELSE 'match'
  END AS parity_status
FROM run_rows r
FULL OUTER JOIN output_rows o
  ON o.forecast_generated_at = r.forecast_generated_at
 AND o.source_model = r.source_model
 AND o.customer_id = r.customer_id
 AND o.sku = r.sku
 AND o.month_year = r.month_year
WHERE r.forecast_generated_at IS NULL
   OR o.forecast_generated_at IS NULL
   OR r.tier0_latest_month IS DISTINCT FROM o.tier0_latest_month
   OR r.tier0_ly_cartons IS DISTINCT FROM o.tier0_ly_cartons
   OR r.tier0_run_rate IS DISTINCT FROM o.tier0_run_rate
   OR r.tier0_growth IS DISTINCT FROM o.tier0_growth
   OR r.tier0_base_method IS DISTINCT FROM o.tier0_base_method
   OR r.tier0_sell_out_base IS DISTINCT FROM o.tier0_sell_out_base
   OR r.tier0_recent_months IS DISTINCT FROM o.tier0_recent_months
ORDER BY forecast_generated_at, customer_id, sku, month_year;
