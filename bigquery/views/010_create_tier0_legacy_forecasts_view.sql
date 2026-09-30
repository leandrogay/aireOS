-- Tier 0 legacy baseline: the P&L sell-out base, for every forecast origin.
--
-- Project: aire-data
-- Dataset: Aire_Data_Analytics
-- Grain: origin month + customer + SKU + target month
-- history_months = months of sales the series had at that origin.
--
-- The P&L's "Forecast with Build" sheet sets each future Sell-out Base by hand
-- from two habits: same month last year x a growth factor (=M58*1.2,
-- =L104*1.05) or a recent month carried forward (=X58, =W104). This automates
-- both, as in backend/app/services/pl_forecast.py (forecast_sku):
--
--   predicted = 0.5 x (same month last year x YoY growth) + 0.5 x (3-month run-rate)
--               (run-rate only when last year or the growth window is missing)
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
--   - the latest origin        -> the live 13-month forecast (future months)
--   - the origin 3 months back -> the holdout score, same cut-off as Tier 1
--   - every earlier origin     -> past errors, which give the 80% range
--
-- Tuning values match pl_forecast.ForecastParams; change them in `params` only.
-- Safe to rerun: this script only creates or replaces a BigQuery view.

CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.fc_tier0_forecasts` AS
WITH params AS (
  SELECT
    0.5  AS ly_weight,        -- share of the forecast from last year x growth
    0.85 AS growth_floor,     -- YoY growth is clipped to [floor, cap]
    1.25 AS growth_cap,
    13   AS horizon_months    -- same horizon as the Tier 1 models
),
history AS (
  SELECT customer_id, sku, month_year, quantity_cartons
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
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
  -- Run-rate over the latest 3 months; growth only when those 3 months and the
  -- same 3 months a year earlier are all present.
  SELECT
    l.origin_month,
    l.customer_id,
    l.sku,
    l.latest_month,
    COUNT(*) AS history_months,
    AVG(IF(k.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH), k.quantity_cartons, NULL)) AS run_rate,
    COUNTIF(k.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH)) AS recent_months,
    SUM(IF(k.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH), k.quantity_cartons, 0)) AS recent_total,
    COUNTIF(k.month_year > DATE_SUB(l.latest_month, INTERVAL 15 MONTH)
        AND k.month_year <= DATE_SUB(l.latest_month, INTERVAL 12 MONTH)) AS last_year_months,
    SUM(IF(k.month_year > DATE_SUB(l.latest_month, INTERVAL 15 MONTH)
       AND k.month_year <= DATE_SUB(l.latest_month, INTERVAL 12 MONTH), k.quantity_cartons, 0)) AS last_year_total
  FROM series_latest l
  JOIN known_history k
    ON k.origin_month = l.origin_month
   AND k.customer_id = l.customer_id
   AND k.sku = l.sku
  GROUP BY l.origin_month, l.customer_id, l.sku, l.latest_month
),
series_growth AS (
  SELECT
    r.*,
    IF(r.recent_months = 3 AND r.last_year_months = 3 AND r.last_year_total > 0,
       LEAST(GREATEST(r.recent_total / r.last_year_total, p.growth_floor), p.growth_cap),
       NULL) AS growth
  FROM series_rates r
  CROSS JOIN params p
),

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
    g.growth,
    target_month,
    DATE_DIFF(target_month, g.latest_month, MONTH) AS horizon
  FROM series_growth g
  CROSS JOIN params p
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(
    DATE_ADD(g.latest_month, INTERVAL 1 MONTH),
    DATE_ADD(g.origin_month, INTERVAL p.horizon_months MONTH),
    INTERVAL 1 MONTH)) AS target_month
),
kept_targets AS (
  -- Past origins keep only months with actual sales (to score against);
  -- the latest origin keeps the months fc_future_input asks for.
  SELECT
    t.*,
    a.quantity_cartons AS actual_quantity_cartons
  FROM targets t
  CROSS JOIN last
  LEFT JOIN history a
    ON a.customer_id = t.customer_id AND a.sku = t.sku AND a.month_year = t.target_month
  LEFT JOIN `aire-data.Aire_Data_Analytics.fc_future_input` f
    ON f.customer_id = t.customer_id AND f.sku = t.sku AND f.month_year = t.target_month
  WHERE (t.origin_month < last.last_month AND a.month_year IS NOT NULL)
     OR (t.origin_month = last.last_month AND f.month_year IS NOT NULL)
),
forecast AS (
  SELECT
    t.*,
    IF(t.growth IS NOT NULL AND ly.quantity_cartons IS NOT NULL,
       p.ly_weight * ly.quantity_cartons * t.growth + (1 - p.ly_weight) * t.run_rate,
       t.run_rate) AS sell_out_base,
    IF(t.growth IS NOT NULL AND ly.quantity_cartons IS NOT NULL,
       'ly_x_growth+runrate', 'runrate') AS base_method
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
