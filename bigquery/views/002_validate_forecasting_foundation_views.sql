-- Read-only validation for the forecasting foundation views.
-- Run after 001_create_forecasting_foundation_views.sql.

-- 1. Enrichment must not add or remove sell-out facts.
SELECT
  (SELECT COUNT(*) FROM `aire-data.Aire_Data_Analytics.public_sellout`)
    AS raw_sellout_rows,
  (SELECT COUNT(*) FROM `aire-data.Aire_Data_Analytics.v_sales_enriched`)
    AS enriched_sellout_rows;


-- 2. The two monthly views must have unique declared keys.
SELECT
  'v_customer_monthly_sales' AS view_name,
  COUNT(*) AS duplicate_key_groups
FROM (
  SELECT customer_id, sku, period_start
  FROM `aire-data.Aire_Data_Analytics.v_customer_monthly_sales`
  GROUP BY customer_id, sku, period_start
  HAVING COUNT(*) > 1
)

UNION ALL

SELECT
  'v_promotion_features_monthly',
  COUNT(*)
FROM (
  SELECT customer_id, sku, period_start
  FROM `aire-data.Aire_Data_Analytics.v_promotion_features_monthly`
  GROUP BY customer_id, sku, period_start
  HAVING COUNT(*) > 1
)

UNION ALL

SELECT
  'v_forecasting_foundation_monthly',
  COUNT(*)
FROM (
  SELECT customer_id, sku, period_start
  FROM `aire-data.Aire_Data_Analytics.v_forecasting_foundation_monthly`
  GROUP BY customer_id, sku, period_start
  HAVING COUNT(*) > 1
);


-- 3. Event view count must equal the intentional promotion-store-SKU fan-out.
WITH sku_counts AS (
  SELECT promotion_id, COUNT(*) AS sku_count
  FROM `aire-data.Aire_Data_Analytics.public_promotion_skus`
  GROUP BY promotion_id
),
store_counts AS (
  SELECT promotion_id, COUNT(*) AS store_count
  FROM `aire-data.Aire_Data_Analytics.public_promotion_stores`
  GROUP BY promotion_id
)
SELECT
  SUM(sku.sku_count * store.store_count) AS expected_event_rows,
  (
    SELECT COUNT(*)
    FROM `aire-data.Aire_Data_Analytics.v_promotion_events_enriched`
  ) AS actual_event_rows
FROM sku_counts AS sku
JOIN store_counts AS store USING (promotion_id);


-- 4. Monthly sales must equal the effective source totals: monthly facts win
--    for a retailer + calendar month, otherwise weekly facts are retained.
--    Both differences must be zero (allowing tiny floating-point noise).
WITH source_with_month AS (
  SELECT
    sellout.*,
    DATE_TRUNC(sellout.period_start, MONTH) AS sales_month
  FROM `aire-data.Aire_Data_Analytics.public_sellout` AS sellout
),
monthly_coverage AS (
  SELECT DISTINCT
    retailer_id,
    sales_month
  FROM source_with_month
  WHERE period_type = 'month'
),
effective_source AS (
  SELECT source.*
  FROM source_with_month AS source
  WHERE source.period_type = 'month'

  UNION ALL

  SELECT source.*
  FROM source_with_month AS source
  WHERE source.period_type = 'week'
    AND NOT EXISTS (
      SELECT 1
      FROM monthly_coverage AS coverage
      WHERE coverage.retailer_id = source.retailer_id
        AND coverage.sales_month = source.sales_month
    )
),
expected AS (
  SELECT
    SUM(quantity_units) AS quantity_cartons,
    SUM(revenue) AS revenue
  FROM effective_source
),
actual AS (
  SELECT
    SUM(quantity_cartons) AS quantity_cartons,
    SUM(revenue) AS revenue
  FROM `aire-data.Aire_Data_Analytics.v_customer_monthly_sales`
)
SELECT
  expected.quantity_cartons AS expected_quantity_cartons,
  actual.quantity_cartons AS actual_quantity_cartons,
  ROUND(actual.quantity_cartons - expected.quantity_cartons, 6)
    AS quantity_difference,
  expected.revenue AS expected_revenue,
  actual.revenue AS actual_revenue,
  ROUND(actual.revenue - expected.revenue, 6) AS revenue_difference
FROM expected
CROSS JOIN actual;


-- 4b. Check the same invariant at customer + SKU + month grain so differences
--     cannot cancel each other out in the overall totals. Must return zero rows.
WITH source_with_month AS (
  SELECT
    sellout.*,
    DATE_TRUNC(sellout.period_start, MONTH) AS sales_month
  FROM `aire-data.Aire_Data_Analytics.public_sellout` AS sellout
),
monthly_coverage AS (
  SELECT DISTINCT retailer_id, sales_month
  FROM source_with_month
  WHERE period_type = 'month'
),
effective_source AS (
  SELECT source.*
  FROM source_with_month AS source
  WHERE source.period_type = 'month'

  UNION ALL

  SELECT source.*
  FROM source_with_month AS source
  WHERE source.period_type = 'week'
    AND NOT EXISTS (
      SELECT 1
      FROM monthly_coverage AS coverage
      WHERE coverage.retailer_id = source.retailer_id
        AND coverage.sales_month = source.sales_month
    )
),
expected_by_key AS (
  SELECT
    bridge.customer_id,
    source.sku,
    source.sales_month AS period_start,
    SUM(source.quantity_units) AS quantity_cartons,
    SUM(source.revenue) AS revenue
  FROM effective_source AS source
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS bridge
    ON bridge.retailer_id = source.retailer_id
  GROUP BY bridge.customer_id, source.sku, source.sales_month
),
actual_by_key AS (
  SELECT
    customer_id,
    sku,
    period_start,
    quantity_cartons,
    revenue
  FROM `aire-data.Aire_Data_Analytics.v_customer_monthly_sales`
)
SELECT
  COALESCE(expected.customer_id, actual.customer_id) AS customer_id,
  COALESCE(expected.sku, actual.sku) AS sku,
  COALESCE(expected.period_start, actual.period_start) AS period_start,
  expected.quantity_cartons AS expected_quantity_cartons,
  actual.quantity_cartons AS actual_quantity_cartons,
  ROUND(actual.quantity_cartons - expected.quantity_cartons, 6)
    AS quantity_difference,
  expected.revenue AS expected_revenue,
  actual.revenue AS actual_revenue,
  ROUND(actual.revenue - expected.revenue, 6) AS revenue_difference
FROM expected_by_key AS expected
FULL OUTER JOIN actual_by_key AS actual
  USING (customer_id, sku, period_start)
WHERE expected.customer_id IS NULL
   OR actual.customer_id IS NULL
   OR ABS(actual.quantity_cartons - expected.quantity_cartons) > 0.000001
   OR ABS(actual.revenue - expected.revenue) > 0.000001
ORDER BY customer_id, sku, period_start;


-- 5. Show domain coverage in the comprehensive monthly foundation.
SELECT
  COUNT(*) AS monthly_rows,
  COUNT(DISTINCT sku) AS sku_count,
  MIN(period_start) AS first_period,
  MAX(period_start) AS last_period,
  COUNTIF(has_sales) AS rows_with_sales,
  COUNTIF(has_promotion) AS rows_with_promotions,
  COUNTIF(has_inventory) AS rows_with_inventory,
  COUNTIF(has_sales AND has_promotion AND has_inventory)
    AS rows_with_all_three_domains
FROM `aire-data.Aire_Data_Analytics.v_forecasting_foundation_monthly`;


-- 6. Preview the nested domain records without flattening or multiplying them.
SELECT
  customer_name,
  sku,
  product_name,
  period_start,
  target_doh,
  has_sales,
  has_promotion,
  has_inventory,
  sales.quantity_cartons AS sales_quantity_cartons,
  sales.revenue AS sales_revenue,
  promotion.promotion_count,
  promotion.promotion_days,
  promotion.promotion_mechanics,
  promotion.promoted_store_coverage,
  inventory
FROM `aire-data.Aire_Data_Analytics.v_forecasting_foundation_monthly`
ORDER BY period_start DESC, sku
LIMIT 20;
