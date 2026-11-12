-- Tier 0 legacy baseline: the P&L sell-out base, for every forecast origin.
--
-- Project: aire-data
-- Dataset: aireos_forecast_validation_sg (the application dataset; the older
--          Aire_Data_Analytics copy still has the growth factor and is reference only)
-- Grain: origin month + customer + SKU + target month
-- history_months = months of sales the series had at that origin.
--
-- Matches the live view as read on 2026-11-09.
--
-- The P&L's "Forecast with Build" sheet sets each future Sell-out Base by hand
-- from two habits: same month last year (there with a growth factor, =M58*1.2,
-- =L104*1.05) or a recent month carried forward (=X58, =W104). This automates
-- both, as in backend/app/services/pl_forecast.py (forecast_sku), but
-- CHANGED (8 Nov evening, team decision): no growth factor.
--
--   predicted = 0.5 x (same month last year) + 0.5 x (3-month run-rate)
--               (run-rate only when that month last year is missing)
--
-- Growth is a planning choice, not a model output: the Scenario builder applies
-- it on top of this base as a growth building block (scenario_building_blocks,
-- kind = 'growth'), never here.
--
-- No promotion uplift. The P&L's Sell-out Building Blocks are hand-entered
-- activity cartons (AO, display, expansion, promoter sampling) that the
-- database doesn't hold, and FairPrice ran a monthly promotion every month
-- since Jan 2025, so the history the base learns from already carries it.
-- Promotion effects are modelled by Tier 1 XREG (promo_mix).
--
-- Every month in fc_training_input is also used as an origin: the formula is
-- recomputed from only the history up to that month. One view therefore
-- serves three uses in run_tier0_legacy:
--   - the latest origin        -> the live 15-month forecast (future months)
--   - the origin 3 months back -> the holdout score, same cut-off as Tier 1
--   - every earlier origin     -> past errors, which give the 80% range
--
-- Tuning values match pl_forecast.ForecastParams; change them in `params` only.
-- Safe to rerun: this script only creates or replaces a BigQuery view.

CREATE OR REPLACE VIEW `aire-data.aireos_forecast_validation_sg.fc_tier0_forecasts` AS
WITH params AS (
  SELECT
    0.5  AS ly_weight,        -- share of the forecast from the same month last year
    -- REMOVED (8 Nov evening): growth_floor 0.85 and growth_cap 1.25 (no growth factor)
    15   AS horizon_months    -- same horizon as the Tier 1 models
),
history AS (
  SELECT customer_id, sku, month_year, quantity_cartons
  FROM `aire-data.aireos_forecast_validation_sg.fc_training_input`
),
last AS (
  SELECT MAX(month_year) AS last_month FROM history
),
origins AS (
  SELECT DISTINCT month_year AS origin_month FROM history
),
known_history AS (
  -- What each origin could see: every month up to and including it.
  SELECT o.origin_month, h.customer_id, h.sku, h.month_year, h.quantity_cartons
  FROM origins o
  JOIN history h
    ON h.month_year <= o.origin_month
),
series_latest AS (
  SELECT origin_month, customer_id, sku, MAX(month_year) AS latest_month
  FROM known_history
  GROUP BY origin_month, customer_id, sku
),
series_rates AS (
  -- Run-rate: the average of the months present in the latest 3 (a missing file is skipped).
  -- CHANGED (8 Nov evening): the recent and last-year totals that fed the growth factor are removed.
  SELECT
    l.origin_month,
    l.customer_id,
    l.sku,
    l.latest_month,
    COUNT(*) AS history_months,
    AVG(IF(k.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH), k.quantity_cartons, NULL)) AS run_rate
  FROM series_latest l
  JOIN known_history k
    ON k.origin_month = l.origin_month
   AND k.customer_id = l.customer_id
   AND k.sku = l.sku
  GROUP BY l.origin_month, l.customer_id, l.sku, l.latest_month
),
-- REMOVED (8 Nov evening): series_growth (the clipped year-on-year growth factor)

-- ---- Target months ----------------------------------------------------------
-- Forecast from the month after the series' own latest month, like
-- pl_forecast.forecast_runs, so a series with a gap still chains forward.
targets AS (
  SELECT
    g.origin_month,
    g.customer_id,
    g.sku,
    g.latest_month,
    g.history_months,
    g.run_rate,
    target_month,
    DATE_DIFF(target_month, g.latest_month, MONTH) AS horizon
  FROM series_rates g                              -- CHANGED (8 Nov evening): was series_growth
  CROSS JOIN params p
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(
    DATE_ADD(g.latest_month, INTERVAL 1 MONTH),
    DATE_ADD(g.origin_month, INTERVAL p.horizon_months MONTH),
    INTERVAL 1 MONTH)) AS target_month
),
kept_targets AS (
  -- Past origins keep only months with actual sales (to score against);
  -- the latest origin keeps the months fc_future_input asks for.
  -- CHANGED (1 Nov): origins in the last 3 months also keep their future months, so the
  -- Initial refresh (A9b) can read Tier 0's forecast as of a September-November cutoff.
  -- CHANGED (8 Nov): December origins keep all of the next year (last rule below).
  SELECT
    t.*,
    a.quantity_cartons AS actual_quantity_cartons
  FROM targets t
  CROSS JOIN last
  LEFT JOIN history a
    ON a.customer_id = t.customer_id AND a.sku = t.sku AND a.month_year = t.target_month
  LEFT JOIN `aire-data.aireos_forecast_validation_sg.fc_future_input` f
    ON f.customer_id = t.customer_id AND f.sku = t.sku AND f.month_year = t.target_month
  WHERE (t.origin_month < last.last_month AND a.month_year IS NOT NULL)
     OR (t.origin_month = last.last_month AND f.month_year IS NOT NULL)
     OR (t.origin_month >= DATE_SUB(last.last_month, INTERVAL 3 MONTH)
         AND t.target_month > last.last_month)
     -- CHANGED (8 Nov, confirm with the file's owner): a December origin keeps all 12 months of the
     -- next year, so a yearly Initial built after the fact (A11.3 uses DATE '2025-12-01') covers
     -- January-December even where sales have arrived since. Only rows without actuals are added,
     -- so the holdout score and the 80% range (both use rows with actuals) don't change.
     OR (EXTRACT(MONTH FROM t.origin_month) = 12
         AND t.target_month <= DATE_ADD(t.origin_month, INTERVAL 12 MONTH))
),
forecast AS (
  SELECT
    t.*,
    -- CHANGED (8 Nov evening): same month last year as it was, no growth factor. Blended whenever
    -- that month exists (was: only when the growth window was complete too).
    IF(ly.quantity_cartons IS NOT NULL,
       p.ly_weight * ly.quantity_cartons + (1 - p.ly_weight) * t.run_rate,
       t.run_rate) AS sell_out_base,
    IF(ly.quantity_cartons IS NOT NULL, 'ly+runrate', 'runrate') AS base_method   -- was 'ly_x_growth+runrate'
  FROM kept_targets t
  CROSS JOIN params p
  LEFT JOIN known_history ly
    ON ly.origin_month = t.origin_month
   AND ly.customer_id = t.customer_id
   AND ly.sku = t.sku
   AND ly.month_year = DATE_SUB(t.target_month, INTERVAL 12 MONTH)
)
SELECT
  origin_month,
  customer_id,
  sku,
  target_month AS month_year,
  horizon,
  history_months,
  base_method,
  sell_out_base,
  ROUND(sell_out_base) AS predicted_quantity_cartons,
  actual_quantity_cartons
FROM forecast;
