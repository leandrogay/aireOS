-- Phase 3 repository proposal: replace the validation-dataset
-- run_tier0_legacy procedure after the component columns are added.
-- This file has not been executed against BigQuery.

CREATE OR REPLACE PROCEDURE
  `aire-data.aireos_forecast_validation_sg.run_tier0_legacy`(run_ts TIMESTAMP)
BEGIN
  DECLARE last_month DATE DEFAULT (
    SELECT MAX(month_year)
    FROM `aire-data.aireos_forecast_validation_sg.fc_training_input`
  );
  DECLARE holdout_origin DATE DEFAULT DATE_SUB(last_month, INTERVAL 3 MONTH);
  DECLARE min_band_errors INT64 DEFAULT 10;
  DECLARE min_history_months INT64 DEFAULT 6;

  IF last_month IS NULL THEN
    RAISE USING MESSAGE = 'fc_training_input is empty - Tier 0 stopped';
  END IF;

  CREATE TEMP TABLE tier0_forecasts AS
  SELECT * FROM `aire-data.aireos_forecast_validation_sg.fc_tier0_forecasts`;

  DELETE FROM `aire-data.aireos_forecast_validation_sg.fc_model_quality_log`
  WHERE evaluated_at = run_ts AND model_name = 'tier0_legacy';

  DELETE FROM `aire-data.aireos_forecast_validation_sg.aire_forecasting_runs`
  WHERE forecast_generated_at = run_ts AND source_model = 'tier0_legacy';

  INSERT INTO `aire-data.aireos_forecast_validation_sg.fc_model_quality_log`
    (evaluated_at, model_name, customer_id, sku, holdout_from,
     avg_error_cartons, mape, smape)
  SELECT
    run_ts,
    'tier0_legacy',
    customer_id,
    sku,
    DATE_ADD(holdout_origin, INTERVAL 1 MONTH),
    AVG(ABS(predicted_quantity_cartons - actual_quantity_cartons)),
    AVG(SAFE_DIVIDE(
      ABS(predicted_quantity_cartons - actual_quantity_cartons),
      ABS(actual_quantity_cartons)
    )) * 100,
    AVG(SAFE_DIVIDE(
      2 * ABS(predicted_quantity_cartons - actual_quantity_cartons),
      ABS(actual_quantity_cartons) + ABS(predicted_quantity_cartons)
    )) * 100
  FROM tier0_forecasts
  WHERE origin_month = holdout_origin
    AND actual_quantity_cartons IS NOT NULL
  GROUP BY customer_id, sku;

  INSERT INTO `aire-data.aireos_forecast_validation_sg.aire_forecasting_runs`
    (forecast_generated_at, customer_id, sku, month_year, source_model,
     predicted_quantity_cartons, prediction_interval_lower_bound,
     prediction_interval_upper_bound, is_best,
     tier0_latest_month, tier0_ly_cartons, tier0_run_rate, tier0_growth,
     tier0_base_method, tier0_sell_out_base, tier0_recent_months)
  WITH past_errors AS (
    SELECT
      horizon,
      SAFE_DIVIDE(actual_quantity_cartons, predicted_quantity_cartons) AS ratio
    FROM tier0_forecasts
    WHERE origin_month < last_month
      AND history_months >= min_history_months
      AND actual_quantity_cartons IS NOT NULL
      AND predicted_quantity_cartons > 0
  ),
  bands AS (
    SELECT DISTINCT
      horizon,
      COUNT(*) OVER (PARTITION BY horizon) AS errors,
      PERCENTILE_CONT(ratio, 0.1) OVER (PARTITION BY horizon) AS low_ratio,
      PERCENTILE_CONT(ratio, 0.9) OVER (PARTITION BY horizon) AS high_ratio
    FROM past_errors
  ),
  latest AS (
    SELECT *
    FROM tier0_forecasts
    WHERE origin_month = last_month
  ),
  with_band AS (
    SELECT
      l.customer_id,
      l.sku,
      l.month_year,
      l.predicted_quantity_cartons,
      l.latest_month,
      l.ly_cartons,
      l.run_rate,
      l.growth,
      l.base_method,
      l.sell_out_base,
      l.recent_months,
      MIN(b.low_ratio) AS low_ratio,
      MAX(b.high_ratio) AS high_ratio
    FROM latest l
    LEFT JOIN bands b
      ON b.horizon <= l.horizon
     AND b.errors >= min_band_errors
    GROUP BY
      l.customer_id, l.sku, l.month_year, l.predicted_quantity_cartons,
      l.latest_month, l.ly_cartons, l.run_rate, l.growth, l.base_method,
      l.sell_out_base, l.recent_months
  )
  SELECT
    run_ts,
    customer_id,
    sku,
    month_year,
    'tier0_legacy',
    predicted_quantity_cartons,
    predicted_quantity_cartons * low_ratio,
    predicted_quantity_cartons * high_ratio,
    FALSE,
    latest_month,
    ly_cartons,
    run_rate,
    growth,
    base_method,
    sell_out_base,
    recent_months
  FROM with_band;

  DROP TABLE tier0_forecasts;
END;
