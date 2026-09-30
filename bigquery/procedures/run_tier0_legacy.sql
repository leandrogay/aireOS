-- Tier 0 legacy baseline: score it and write its forecast for one pipeline run.
--
-- Project: aire-data
-- Dataset: Aire_Data_Analytics
--
-- Called from run_monthly_forecast_pipeline with that run's run_ts, after the
-- Tier 1 forecasts and before the best-line choice (see
-- pipeline_tier0_changes.sql). Reads fc_tier0_forecasts
-- (views/010_create_tier0_legacy_forecasts_view.sql), so create that first.
--
-- Writes, all tagged 'tier0_legacy':
--   1. model_quality_log      holdout MAE / MAPE / sMAPE per customer x SKU. Same
--                             cut-off (last 3 complete months hidden), same
--                             metric formulas as ML.EVALUATE, so step 3c can
--                             compare Tier 0 with Tier 1 directly.
--   2. aire_forecasting_runs  the 13-month forecast with an 80% range, is_best
--                             FALSE; step 3c adds the is_best row if it wins.
--
-- The 80% range comes from Tier 0's own past errors: for every earlier origin,
-- actual / forecast at each horizon, and the 10th and 90th percentile of those
-- ratios scale the new forecast. Two guards keep it honest:
--   - only origins where the series already had 6+ months of sales count;
--     earlier ones forecast from one or two months and put the 90th
--     percentile at 5-10x the forecast,
--   - a horizon's range is never narrower than a shorter horizon's, and a
--     horizon with fewer than 10 past errors adds nothing of its own.
--
-- Safe to rerun for the same run_ts: it deletes its own rows for that run first.

CREATE OR REPLACE PROCEDURE `aire-data.Aire_Data_Analytics.run_tier0_legacy`(run_ts TIMESTAMP)
BEGIN
  DECLARE last_month DATE DEFAULT (
    SELECT MAX(month_year) FROM `aire-data.Aire_Data_Analytics.fc_training_input`);
  DECLARE holdout_origin DATE DEFAULT DATE_SUB(last_month, INTERVAL 3 MONTH);
  DECLARE min_band_errors INT64 DEFAULT 10;
  DECLARE min_history_months INT64 DEFAULT 6;

  IF last_month IS NULL THEN
    RAISE USING MESSAGE = 'fc_training_input is empty - Tier 0 stopped';
  END IF;

  -- The view recomputes every origin; read it once per run.
  CREATE TEMP TABLE tier0_forecasts AS
  SELECT * FROM `aire-data.Aire_Data_Analytics.fc_tier0_forecasts`;

  DELETE FROM `aire-data.Aire_Data_Analytics.model_quality_log`
  WHERE evaluated_at = run_ts AND model_name = 'tier0_legacy';
  DELETE FROM `aire-data.Aire_Data_Analytics.aire_forecasting_runs`
  WHERE forecast_generated_at = run_ts AND source_model = 'tier0_legacy';

  -- 1. Holdout score: forecast the last 3 months from data up to the cut-off.
  --    holdout_from matches the Tier 1 rows (first hidden month).
  INSERT INTO `aire-data.Aire_Data_Analytics.model_quality_log`
    (evaluated_at, model_name, customer_id, sku, holdout_from, avg_error_cartons, mape, smape)
  SELECT
    run_ts AS evaluated_at,
    'tier0_legacy' AS model_name,
    customer_id,
    sku,
    DATE_ADD(holdout_origin, INTERVAL 1 MONTH) AS holdout_from,
    AVG(ABS(predicted_quantity_cartons - actual_quantity_cartons)) AS avg_error_cartons,
    AVG(SAFE_DIVIDE(ABS(predicted_quantity_cartons - actual_quantity_cartons),
                    ABS(actual_quantity_cartons))) * 100 AS mape,
    AVG(SAFE_DIVIDE(2 * ABS(predicted_quantity_cartons - actual_quantity_cartons),
                    ABS(actual_quantity_cartons) + ABS(predicted_quantity_cartons))) * 100 AS smape
  FROM tier0_forecasts
  WHERE origin_month = holdout_origin
    AND actual_quantity_cartons IS NOT NULL
  GROUP BY customer_id, sku;

  -- 2. Forecast from the latest complete month, with the 80% range.
  INSERT INTO `aire-data.Aire_Data_Analytics.aire_forecasting_runs`
    (forecast_generated_at, customer_id, sku, month_year, source_model,
     predicted_quantity_cartons, prediction_interval_lower_bound, prediction_interval_upper_bound, is_best)
  WITH past_errors AS (
    SELECT horizon, actual_quantity_cartons / predicted_quantity_cartons AS ratio
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
    -- Widest range over this and every shorter horizon with enough errors.
    SELECT
      l.customer_id,
      l.sku,
      l.month_year,
      l.predicted_quantity_cartons,
      MIN(b.low_ratio) AS low_ratio,
      MAX(b.high_ratio) AS high_ratio
    FROM latest l
    LEFT JOIN bands b
      ON b.horizon <= l.horizon
     AND b.errors >= min_band_errors
    GROUP BY l.customer_id, l.sku, l.month_year, l.predicted_quantity_cartons
  )
  SELECT
    run_ts AS forecast_generated_at,
    customer_id,
    sku,
    month_year,
    'tier0_legacy' AS source_model,
    predicted_quantity_cartons,
    predicted_quantity_cartons * low_ratio AS prediction_interval_lower_bound,
    predicted_quantity_cartons * high_ratio AS prediction_interval_upper_bound,
    FALSE AS is_best
  FROM with_band;

  DROP TABLE tier0_forecasts;
END;
