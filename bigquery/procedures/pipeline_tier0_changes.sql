-- Changes to run_monthly_forecast_pipeline so Tier 0 takes part in each run.
--
-- Project: aire-data
-- Dataset: Aire_Data_Analytics
--
-- Two edits to the Tier 1 procedure (owned by the Tier 1 author); everything
-- else about Tier 0 lives in run_tier0_legacy.sql and fc_tier0_forecasts.
-- Column names follow the live views (month_year, promo_entered), not the
-- older period_start / calendar_covered spelling.
--
-- Rule proposed for the best line (agree before deploying):
--   1. Tier 1 picks between ARIMA_PLUS and XREG exactly as before.
--   2. Tier 0 wins a month when no Tier 1 model forecast it (a series too short
--      for ARIMA), or when the chosen Tier 1 model's backtest sMAPE is above
--      tier0_fallback_smape (50 = the 'low' confidence band boundary in
--      v_model_quality_latest) AND Tier 0's backtest sMAPE is lower.
--   Tier 0 never replaces a Tier 1 line it scores worse than.


-- ---- Edit 1 ---------------------------------------------------------------
-- Add this line after step 3b (XREG forecast) and before step 3c:

  CALL `aire-data.Aire_Data_Analytics.run_tier0_legacy`(run_ts);


-- ---- Edit 2 ---------------------------------------------------------------
-- Replace the whole of step 3c with:

  -- 3c. Best line: Tier 1 picks ARIMA_PLUS vs XREG as before; Tier 0 takes the
  --     month when Tier 1 has no forecast, or when Tier 1's backtest sMAPE is
  --     above 50 and Tier 0's is lower.
  INSERT INTO `aire-data.Aire_Data_Analytics.aire_forecasting_runs`
    (forecast_generated_at, customer_id, sku, month_year, source_model,
     predicted_quantity_cartons, prediction_interval_lower_bound, prediction_interval_upper_bound, is_best)
  WITH this_run AS (
    SELECT * FROM `aire-data.Aire_Data_Analytics.aire_forecasting_runs`
    WHERE forecast_generated_at = run_ts AND NOT is_best
  ),
  months AS (
    SELECT DISTINCT customer_id, sku, month_year FROM this_run
  ),
  tier1_choice AS (
    SELECT
      m.customer_id, m.sku, m.month_year,
      CASE
        WHEN x.customer_id IS NOT NULL
         AND COALESCE(fut.promo_entered, FALSE)
         AND COALESCE(fut.promo_mix_seen, FALSE)
         AND qx.smape < qa.smape
        THEN 'tier1_arimax'
        WHEN a.customer_id IS NOT NULL
        THEN 'tier1_arima'
      END AS tier1_model,
      t0.customer_id IS NOT NULL AS has_tier0,
      q0.smape AS tier0_smape,
      qa.smape AS arima_smape,
      qx.smape AS arimax_smape
    FROM months m
    LEFT JOIN this_run a
      ON a.source_model = 'tier1_arima'
     AND a.customer_id = m.customer_id AND a.sku = m.sku AND a.month_year = m.month_year
    LEFT JOIN this_run x
      ON x.source_model = 'tier1_arimax'
     AND x.customer_id = m.customer_id AND x.sku = m.sku AND x.month_year = m.month_year
    LEFT JOIN this_run t0
      ON t0.source_model = 'tier0_legacy'
     AND t0.customer_id = m.customer_id AND t0.sku = m.sku AND t0.month_year = m.month_year
    LEFT JOIN `aire-data.Aire_Data_Analytics.fc_future_input` fut
      ON fut.customer_id = m.customer_id AND fut.sku = m.sku AND fut.month_year = m.month_year
    LEFT JOIN `aire-data.Aire_Data_Analytics.v_model_quality_latest` qa
      ON qa.model_name = 'tier1_arima' AND qa.customer_id = m.customer_id AND qa.sku = m.sku
    LEFT JOIN `aire-data.Aire_Data_Analytics.v_model_quality_latest` qx
      ON qx.model_name = 'tier1_arimax' AND qx.customer_id = m.customer_id AND qx.sku = m.sku
    LEFT JOIN `aire-data.Aire_Data_Analytics.v_model_quality_latest` q0
      ON q0.model_name = 'tier0_legacy' AND q0.customer_id = m.customer_id AND q0.sku = m.sku
  ),
  choice AS (
    SELECT
      customer_id, sku, month_year,
      CASE
        WHEN tier1_model IS NULL AND has_tier0 THEN 'tier0_legacy'
        WHEN has_tier0
         AND IF(tier1_model = 'tier1_arimax', arimax_smape, arima_smape) > 50  -- tier0_fallback_smape
         AND tier0_smape < IF(tier1_model = 'tier1_arimax', arimax_smape, arima_smape)
        THEN 'tier0_legacy'
        ELSE tier1_model
      END AS chosen_model
    FROM tier1_choice
  )
  SELECT r.forecast_generated_at, r.customer_id, r.sku, r.month_year, r.source_model,
         r.predicted_quantity_cartons, r.prediction_interval_lower_bound,
         r.prediction_interval_upper_bound, TRUE
  FROM choice c
  JOIN this_run r
    ON r.customer_id = c.customer_id AND r.sku = c.sku
   AND r.month_year = c.month_year AND r.source_model = c.chosen_model;
