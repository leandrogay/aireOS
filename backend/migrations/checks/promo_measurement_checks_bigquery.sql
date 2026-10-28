-- READ-ONLY checks for the promotion uplift measurement job (Stage 2).
-- Run each block separately in the BigQuery console (project aire-data) and
-- paste every result back. Nothing here creates, changes or deletes anything.
--
-- Some table/column names below are not referenced anywhere in the repo yet
-- (aire_forecasting_archive, fc_backtest_input). B0 lists what really exists;
-- if a later block fails with "Unrecognized name", paste B0 and the error.


-- ============================================================
-- B0. What exists: every table/view in the dataset, then the columns of the
--     ones the job needs.
-- ============================================================

-- B0a
SELECT table_name, table_type, creation_time
FROM `aire-data.Aire_Data_Analytics`.INFORMATION_SCHEMA.TABLES
ORDER BY table_name;

-- B0b
SELECT table_name, ordinal_position, column_name, data_type
FROM `aire-data.Aire_Data_Analytics`.INFORMATION_SCHEMA.COLUMNS
WHERE table_name IN (
    'fc_training_input',
    'aire_forecasting_archive',
    'aire_forecasting_runs',
    'fc_backtest_input',
    'fc_model_quality_log',
    'fc_model_quality_views',
    'public_customers',
    'public_customer_retailers',
    'public_skus'
  )
  OR table_name LIKE '%backtest%'
  OR table_name LIKE '%archive%'
  OR table_name LIKE 'public_promo%'
ORDER BY table_name, ordinal_position;


-- ============================================================
-- B1. fc_training_input: units per customer + SKU + month, and the months
--     covered. The job's window = exactly these months.
-- ============================================================

-- B1a. Whole table: window, size, duplicate keys, empty values.
SELECT
  MIN(month_year) AS window_start,
  MAX(month_year) AS window_end,
  COUNT(*) AS rows_total,
  COUNT(DISTINCT FORMAT('%t|%t', customer_id, sku)) AS series,
  COUNT(*) - COUNT(DISTINCT FORMAT('%t|%t|%t', customer_id, sku, month_year)) AS duplicate_keys,
  COUNTIF(quantity_cartons IS NULL) AS null_quantity,
  COUNTIF(quantity_cartons <= 0) AS zero_or_negative_quantity,
  COUNTIF(EXTRACT(DAY FROM month_year) != 1) AS month_not_first_of_month
FROM `aire-data.Aire_Data_Analytics.fc_training_input`;

-- B1b. Per series: first/last month, months present, gaps inside the range.
--      Gaps matter for the straight-line trend (minimum 6 months to fit one).
SELECT
  t.customer_id,
  c.customer_name,
  t.sku,
  s.product_name,
  MIN(t.month_year) AS first_month,
  MAX(t.month_year) AS last_month,
  COUNT(*) AS months_present,
  DATE_DIFF(MAX(t.month_year), MIN(t.month_year), MONTH) + 1 - COUNT(*) AS missing_months_inside,
  ROUND(AVG(t.quantity_cartons), 1) AS avg_cartons
FROM `aire-data.Aire_Data_Analytics.fc_training_input` AS t
LEFT JOIN `aire-data.Aire_Data_Analytics.public_customers` AS c
  ON c.customer_id = t.customer_id
LEFT JOIN `aire-data.Aire_Data_Analytics.public_skus` AS s
  ON s.sku = t.sku
GROUP BY t.customer_id, c.customer_name, t.sku, s.product_name
ORDER BY c.customer_name, s.product_name;


-- ============================================================
-- B2. aire_forecasting_archive: forecasts made BEFORE each target month,
--     with run timestamps. Column names are assumed to match
--     aire_forecasting_runs (forecast_generated_at, customer_id, sku,
--     month_year, predicted_quantity_cartons, source_model, is_best);
--     check them against B0b first.
-- ============================================================

-- B2a. Runs kept, and their date range.
SELECT
  COUNT(DISTINCT forecast_generated_at) AS runs,
  MIN(forecast_generated_at) AS first_run,
  MAX(forecast_generated_at) AS last_run,
  COUNT(*) AS rows_total,
  COUNTIF(is_best) AS best_rows
FROM `aire-data.Aire_Data_Analytics.aire_forecasting_archive`;

-- B2b. For each target month: how many runs forecast it before it began,
--      and the latest such run (the "forecast made before that month").
SELECT
  month_year,
  COUNT(DISTINCT forecast_generated_at) AS runs_before_month,
  MAX(forecast_generated_at) AS latest_run_before_month,
  COUNT(DISTINCT FORMAT('%t|%t', customer_id, sku)) AS series
FROM `aire-data.Aire_Data_Analytics.aire_forecasting_archive`
WHERE is_best
  AND DATE(forecast_generated_at) < month_year
GROUP BY month_year
ORDER BY month_year;


-- ============================================================
-- B3. Backtest forecast vs actual per backtest month. The repo never reads
--     fc_backtest_input, so first just look at it (and at the quality log,
--     which may hold the same thing).
-- ============================================================

-- B3a
SELECT *
FROM `aire-data.Aire_Data_Analytics.fc_backtest_input`
LIMIT 20;

-- B3b
SELECT *
FROM `aire-data.Aire_Data_Analytics.fc_model_quality_log`
LIMIT 20;

-- B3c. Row counts, so I know their size.
SELECT 'fc_backtest_input' AS table_name, COUNT(*) AS row_count
FROM `aire-data.Aire_Data_Analytics.fc_backtest_input`
UNION ALL
SELECT 'fc_model_quality_log', COUNT(*)
FROM `aire-data.Aire_Data_Analytics.fc_model_quality_log`;


-- ============================================================
-- B4. Keys join to Cloud SQL. customer_id and sku in the training input must
--     exist in the Datastream copies of customers / skus (which are Cloud SQL
--     rows), and every customer must reach its retailers through the bridge.
--     Expect every count to be 0 and the last query to list each customer
--     with its offline/online retailers.
-- ============================================================

-- B4a
SELECT
  COUNTIF(c.customer_id IS NULL) AS training_customers_missing_in_customers,
  COUNTIF(s.sku IS NULL) AS training_skus_missing_in_skus
FROM (
  SELECT DISTINCT customer_id, sku
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
) AS t
LEFT JOIN `aire-data.Aire_Data_Analytics.public_customers` AS c
  ON c.customer_id = t.customer_id
LEFT JOIN `aire-data.Aire_Data_Analytics.public_skus` AS s
  ON s.sku = t.sku;

-- B4b. Product names that are not unique (the Scenario builder keys SKU
--      values by product name; duplicates would collide).
SELECT product_name, COUNT(*) AS skus, STRING_AGG(sku, ', ') AS sku_codes
FROM `aire-data.Aire_Data_Analytics.public_skus`
WHERE product_name IS NOT NULL
GROUP BY product_name
HAVING COUNT(*) > 1;

-- B4c
SELECT
  c.customer_id,
  c.customer_name,
  ARRAY_AGG(DISTINCT b.retailer_id IGNORE NULLS) AS retailer_ids
FROM `aire-data.Aire_Data_Analytics.public_customers` AS c
LEFT JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS b
  ON b.customer_id = c.customer_id
GROUP BY c.customer_id, c.customer_name
ORDER BY c.customer_name;
