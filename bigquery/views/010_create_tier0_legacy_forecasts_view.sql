-- Tier 0 legacy baseline: the P&L sell-out formula, for every forecast origin.
--
-- Project: aire-data
-- Dataset: Aire_Data_Analytics
-- Grain: origin month + customer + SKU + target month
-- history_months = months of sales the series had at that origin.
--
-- SQL port of backend/app/services/pl_forecast.py (forecast_sku, estimate_uplifts):
--
--   predicted = Base + Building Blocks
--   Base      = 0.5 x (same month last year x YoY growth) + 0.5 x (3-month run-rate)
--               (run-rate only when last year or the growth window is missing)
--   Building  = Base x uplift for the month's promo_mix
--
-- Every month in fc_training_input is also used as an origin: the formula is
-- recomputed from only the history up to that month. One view therefore
-- serves three uses in run_tier0_legacy:
--   - the latest origin        -> the live 13-month forecast (future months)
--   - the origin 3 months back -> the holdout score, same cut-off as Tier 1
--   - every earlier origin     -> past errors, which give the 80% range
--
-- promo_mix 'no_promos' is "no promotion"; every other value is a promotion.
-- An uplift is the median of (promo month / average of neighbouring
-- no-promotion months) - 1 across all series, capped to [0, 1], and 0 until a
-- promo_mix has 3 such comparisons. FairPrice had a monthly promotion in every
-- month since Jan 2025, so today no comparison exists and every uplift is 0.
--
-- Tuning values match pl_forecast.ForecastParams; change them in `params` only.
-- Safe to rerun: this script only creates or replaces a BigQuery view.

CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.fc_tier0_forecasts` AS
WITH params AS (
  SELECT
    0.5  AS ly_weight,        -- share of Base from last year x growth
    0.85 AS growth_floor,     -- YoY growth is clipped to [floor, cap]
    1.25 AS growth_cap,
    1.0  AS uplift_cap,       -- no promotion more than doubles sell-out
    3    AS min_uplift_obs,   -- fewer comparisons than this -> uplift 0
    13   AS horizon_months    -- same horizon as the Tier 1 models
),
history AS (
  SELECT customer_id, sku, month_year, quantity_cartons, promo_mix
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
),
last AS (
  SELECT MAX(month_year) AS last_month FROM history
),
origins AS (
  SELECT DISTINCT month_year AS origin_month FROM history
),

-- ---- Uplift per origin + promo_mix ------------------------------------------
promo_neighbours AS (
  -- Each promotion month with its no-promotion neighbours (NULL when the
  -- neighbour is missing or had a promotion too).
  SELECT
    h.customer_id,
    h.sku,
    h.month_year,
    h.promo_mix,
    h.quantity_cartons,
    prev.quantity_cartons AS prev_quantity,
    next.quantity_cartons AS next_quantity,
    next.month_year AS next_month
  FROM history h
  LEFT JOIN history prev
    ON prev.customer_id = h.customer_id
   AND prev.sku = h.sku
   AND prev.month_year = DATE_SUB(h.month_year, INTERVAL 1 MONTH)
   AND prev.promo_mix = 'no_promos'
  LEFT JOIN history next
    ON next.customer_id = h.customer_id
   AND next.sku = h.sku
   AND next.month_year = DATE_ADD(h.month_year, INTERVAL 1 MONTH)
   AND next.promo_mix = 'no_promos'
  WHERE h.promo_mix <> 'no_promos'
),
promo_neighbours_known AS (
  -- The following month only counts once the origin has reached it.
  SELECT
    o.origin_month,
    n.promo_mix,
    n.quantity_cartons,
    IF(n.prev_quantity IS NOT NULL, 1, 0)
      + IF(n.next_month <= o.origin_month, 1, 0) AS neighbour_count,
    COALESCE(n.prev_quantity, 0)
      + IF(n.next_month <= o.origin_month, n.next_quantity, 0) AS neighbour_sum
  FROM origins o
  JOIN promo_neighbours n
    ON n.month_year <= o.origin_month
),
promo_ratios AS (
  SELECT
    origin_month,
    promo_mix,
    quantity_cartons / (neighbour_sum / neighbour_count) AS ratio
  FROM promo_neighbours_known
  WHERE neighbour_count > 0
    AND neighbour_sum > 0
),
promo_medians AS (
  SELECT DISTINCT
    origin_month,
    promo_mix,
    COUNT(*) OVER (PARTITION BY origin_month, promo_mix) AS observations,
    PERCENTILE_CONT(ratio, 0.5) OVER (PARTITION BY origin_month, promo_mix) AS median_ratio
  FROM promo_ratios
),
uplifts AS (
  SELECT
    m.origin_month,
    m.promo_mix,
    IF(m.observations < p.min_uplift_obs, 0.0,
       LEAST(GREATEST(m.median_ratio - 1, 0.0), p.uplift_cap)) AS uplift
  FROM promo_medians m
  CROSS JOIN params p
),

-- ---- Base history per origin (past promotion uplift taken back out) --------
base_history AS (
  SELECT
    o.origin_month,
    h.customer_id,
    h.sku,
    h.month_year,
    h.quantity_cartons / (1 + COALESCE(u.uplift, 0.0)) AS base
  FROM origins o
  JOIN history h
    ON h.month_year <= o.origin_month
  LEFT JOIN uplifts u
    ON u.origin_month = o.origin_month
   AND u.promo_mix = h.promo_mix
),
series_latest AS (
  SELECT origin_month, customer_id, sku, MAX(month_year) AS latest_month
  FROM base_history
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
    AVG(IF(b.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH), b.base, NULL)) AS run_rate,
    COUNTIF(b.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH)) AS recent_months,
    SUM(IF(b.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH), b.base, 0)) AS recent_base,
    COUNTIF(b.month_year > DATE_SUB(l.latest_month, INTERVAL 15 MONTH)
        AND b.month_year <= DATE_SUB(l.latest_month, INTERVAL 12 MONTH)) AS last_year_months,
    SUM(IF(b.month_year > DATE_SUB(l.latest_month, INTERVAL 15 MONTH)
       AND b.month_year <= DATE_SUB(l.latest_month, INTERVAL 12 MONTH), b.base, 0)) AS last_year_base
  FROM series_latest l
  JOIN base_history b
    ON b.origin_month = l.origin_month
   AND b.customer_id = l.customer_id
   AND b.sku = l.sku
  GROUP BY l.origin_month, l.customer_id, l.sku, l.latest_month
),
series_growth AS (
  SELECT
    r.*,
    IF(r.recent_months = 3 AND r.last_year_months = 3 AND r.last_year_base > 0,
       LEAST(GREATEST(r.recent_base / r.last_year_base, p.growth_floor), p.growth_cap),
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
labelled_targets AS (
  -- Past origins keep only months with actual sales (to score against);
  -- the latest origin keeps the months fc_future_input asks for.
  SELECT
    t.*,
    COALESCE(a.promo_mix, f.promo_mix, 'no_promos') AS promo_mix,
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
    IF(t.growth IS NOT NULL AND ly.base IS NOT NULL,
       p.ly_weight * ly.base * t.growth + (1 - p.ly_weight) * t.run_rate,
       t.run_rate) AS sell_out_base,
    IF(t.growth IS NOT NULL AND ly.base IS NOT NULL,
       'ly_x_growth+runrate', 'runrate') AS base_method,
    IF(t.promo_mix = 'no_promos', 0.0, COALESCE(u.uplift, 0.0)) AS uplift
  FROM labelled_targets t
  CROSS JOIN params p
  LEFT JOIN base_history ly
    ON ly.origin_month = t.origin_month
   AND ly.customer_id = t.customer_id
   AND ly.sku = t.sku
   AND ly.month_year = DATE_SUB(t.target_month, INTERVAL 12 MONTH)
  LEFT JOIN uplifts u
    ON u.origin_month = t.origin_month
   AND u.promo_mix = t.promo_mix
)
SELECT
  origin_month,
  customer_id,
  sku,
  target_month AS month_year,
  horizon,
  history_months,
  promo_mix,
  base_method,
  sell_out_base,
  sell_out_base * uplift AS sell_out_building_blocks,
  ROUND(sell_out_base * (1 + uplift)) AS predicted_quantity_cartons,
  actual_quantity_cartons
FROM forecast;
