-- Phase 3 repository proposal: validation-dataset Tier 0 view with
-- component provenance. This has not been executed against BigQuery.
--
-- Unlike 010_create_tier0_legacy_forecasts_view.sql, this targets the live
-- application dataset and deliberately has no growth factor.

CREATE OR REPLACE VIEW `aire-data.aireos_forecast_validation_sg.fc_tier0_forecasts` AS
WITH params AS (
  SELECT 0.5 AS ly_weight, 15 AS horizon_months
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
  SELECT o.origin_month, h.customer_id, h.sku, h.month_year, h.quantity_cartons
  FROM origins o
  JOIN history h ON h.month_year <= o.origin_month
),
series_latest AS (
  SELECT origin_month, customer_id, sku, MAX(month_year) AS latest_month
  FROM known_history
  GROUP BY origin_month, customer_id, sku
),
series_rates AS (
  SELECT
    l.origin_month,
    l.customer_id,
    l.sku,
    l.latest_month,
    COUNT(*) AS history_months,
    AVG(IF(
      k.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH),
      k.quantity_cartons,
      NULL
    )) AS run_rate,
    ARRAY_AGG(
      IF(
        k.month_year > DATE_SUB(l.latest_month, INTERVAL 3 MONTH),
        k.month_year,
        NULL
      )
      IGNORE NULLS
      ORDER BY k.month_year
    ) AS recent_months
  FROM series_latest l
  JOIN known_history k
    ON k.origin_month = l.origin_month
   AND k.customer_id = l.customer_id
   AND k.sku = l.sku
  GROUP BY l.origin_month, l.customer_id, l.sku, l.latest_month
),
targets AS (
  SELECT
    g.origin_month,
    g.customer_id,
    g.sku,
    g.latest_month,
    g.history_months,
    g.run_rate,
    g.recent_months,
    target_month,
    DATE_DIFF(target_month, g.latest_month, MONTH) AS horizon
  FROM series_rates g
  CROSS JOIN params p
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(
    DATE_ADD(g.latest_month, INTERVAL 1 MONTH),
    DATE_ADD(g.origin_month, INTERVAL p.horizon_months MONTH),
    INTERVAL 1 MONTH
  )) AS target_month
),
kept_targets AS (
  SELECT t.*, a.quantity_cartons AS actual_quantity_cartons
  FROM targets t
  CROSS JOIN last
  LEFT JOIN history a
    ON a.customer_id = t.customer_id
   AND a.sku = t.sku
   AND a.month_year = t.target_month
  LEFT JOIN `aire-data.aireos_forecast_validation_sg.fc_future_input` f
    ON f.customer_id = t.customer_id
   AND f.sku = t.sku
   AND f.month_year = t.target_month
  WHERE (t.origin_month < last.last_month AND a.month_year IS NOT NULL)
     OR (t.origin_month = last.last_month AND f.month_year IS NOT NULL)
     OR (
       t.origin_month >= DATE_SUB(last.last_month, INTERVAL 3 MONTH)
       AND t.target_month > last.last_month
     )
     OR (
       EXTRACT(MONTH FROM t.origin_month) = 12
       AND t.target_month <= DATE_ADD(t.origin_month, INTERVAL 12 MONTH)
     )
),
forecast AS (
  SELECT
    t.*,
    ly.quantity_cartons AS ly_cartons,
    IF(
      ly.quantity_cartons IS NOT NULL,
      p.ly_weight * ly.quantity_cartons + (1 - p.ly_weight) * t.run_rate,
      t.run_rate
    ) AS sell_out_base,
    IF(ly.quantity_cartons IS NOT NULL, 'ly+runrate', 'runrate') AS base_method
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
  month_year,
  horizon,
  history_months,
  latest_month,
  ly_cartons,
  run_rate,
  CAST(NULL AS FLOAT64) AS growth,
  base_method,
  sell_out_base,
  recent_months,
  ROUND(sell_out_base) AS predicted_quantity_cartons,
  actual_quantity_cartons
FROM forecast;
