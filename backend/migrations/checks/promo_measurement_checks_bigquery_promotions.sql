-- READ-ONLY checks on the promotion data (C0-C5), for the BigQuery console
-- (project aire-data). Same questions as promo_measurement_checks_cloudsql.sql,
-- but reading the Datastream copies of the Cloud SQL tables (public_promotions,
-- public_promotion_skus, public_promotion_stores, public_stores,
-- public_customer_retailers), which are only minutes behind Cloud SQL. No dates
-- to type in: the window is read straight from fc_training_input.
--
-- Run each block separately and paste every result back. Nothing here creates,
-- changes or deletes anything.
--
-- Mechanic keys use the same pattern rules as the backend's
-- promo_uplift_rules.mechanic_key. One small difference: the backend treats
-- "25.0%" and "25%" as the same key; this SQL does not.


-- ============================================================
-- C0. Every typed mechanic, the key it reads as, and how many promotions use
--     it. Expect no row with an empty mechanic_key (an unreadable label).
-- ============================================================

WITH labels AS (
  SELECT
    promotion_mechanic,
    promo_type,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(promotion_mechanic), r'\s+', ' '), r'\s*%\s*', '% ')) AS t
  FROM `aire-data.Aire_Data_Analytics.public_promotions`
)
SELECT
  promotion_mechanic,
  promo_type,
  CASE
    WHEN t = 'voucher' THEN 'voucher'
    WHEN REGEXP_CONTAINS(t, r'^b\d+g\d+$') THEN t
    WHEN REGEXP_CONTAINS(t, r'^buy \d+ get \d+ free$') THEN REGEXP_REPLACE(t, r'^buy (\d+) get (\d+) free$', r'b\1g\2')
    WHEN REGEXP_CONTAINS(t, r'^buy \d+ get \d+(?:\.\d+)?% ?(?:off)?$') THEN REGEXP_REPLACE(t, r'^buy (\d+) get (\d+(?:\.\d+)?)% ?(?:off)?$', r'b\1_pct_off_\2')
    WHEN REGEXP_CONTAINS(t, r'^\d+(?:\.\d+)?% ?(?:off)?$') THEN REGEXP_REPLACE(t, r'^(\d+(?:\.\d+)?)% ?(?:off)?$', r'pct_off_\1')
  END AS mechanic_key,
  COUNT(*) AS promotions
FROM labels
GROUP BY promotion_mechanic, promo_type, t
ORDER BY mechanic_key NULLS FIRST, promotion_mechanic;


-- ============================================================
-- C1. Evidence per customer + mechanic, inside each series' training months,
--     with the day-share rule and the contrast rule.
--       series_with_it        SKUs that ran it in at least one training month
--       series_with_contrast  SKUs that have months both WITH and WITHOUT it
--                             (only these count as evidence)
--       customer_months       distinct months the customer ran it (N)
--       n_with_contrast       summed day shares in the contrast SKUs (sum of n)
--       n_all                 the same without the contrast rule, to compare
--       dropped_by_7_days     side-offer SKU-months under 7 days in the month
--     Day shares are raw: a side offer's days are not yet taken away from the
--     monthly promotion it replaces (the job does that).
-- ============================================================

WITH promo AS (
  SELECT DISTINCT
    cr.customer_id,
    psk.sku,
    p.promotion_id,
    REGEXP_REPLACE(p.promo_type, r'^carton_', '') = 'monthly' AS is_monthly,
    p.period_start,
    p.period_end,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(p.promotion_mechanic), r'\s+', ' '), r'\s*%\s*', '% ')) AS t
  FROM `aire-data.Aire_Data_Analytics.public_promotions` AS p
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_stores` AS ps ON ps.promotion_id = p.promotion_id
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS s ON s.store_id = ps.store_id
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr ON cr.retailer_id = s.retailer_id
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_skus` AS psk ON psk.promotion_id = p.promotion_id
),
keyed AS (
  SELECT
    promo.*,
    CASE
      WHEN t = 'voucher' THEN 'voucher'
      WHEN REGEXP_CONTAINS(t, r'^b\d+g\d+$') THEN t
      WHEN REGEXP_CONTAINS(t, r'^buy \d+ get \d+ free$') THEN REGEXP_REPLACE(t, r'^buy (\d+) get (\d+) free$', r'b\1g\2')
      WHEN REGEXP_CONTAINS(t, r'^buy \d+ get \d+(?:\.\d+)?% ?(?:off)?$') THEN REGEXP_REPLACE(t, r'^buy (\d+) get (\d+(?:\.\d+)?)% ?(?:off)?$', r'b\1_pct_off_\2')
      WHEN REGEXP_CONTAINS(t, r'^\d+(?:\.\d+)?% ?(?:off)?$') THEN REGEXP_REPLACE(t, r'^(\d+(?:\.\d+)?)% ?(?:off)?$', r'pct_off_\1')
    END AS mechanic_key
  FROM promo
),
days AS (
  SELECT
    k.customer_id, k.sku, k.mechanic_key, k.is_monthly,
    DATE_TRUNC(d, MONTH) AS month,
    COUNT(DISTINCT d) AS days_run
  FROM keyed AS k, UNNEST(GENERATE_DATE_ARRAY(k.period_start, k.period_end)) AS d
  GROUP BY k.customer_id, k.sku, k.mechanic_key, k.is_monthly, month
),
cells AS (
  -- Only months the forecast model trains on, for that series.
  SELECT
    d.*,
    d.days_run / EXTRACT(DAY FROM LAST_DAY(d.month)) AS day_share,
    (d.is_monthly OR d.days_run >= 7) AS counts
  FROM days AS d
  JOIN `aire-data.Aire_Data_Analytics.fc_training_input` AS t
    ON t.customer_id = d.customer_id AND t.sku = d.sku AND t.month_year = d.month
),
series_months AS (
  SELECT customer_id, sku, COUNT(*) AS months
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
  GROUP BY customer_id, sku
),
per_series AS (
  SELECT
    customer_id, sku, mechanic_key, is_monthly,
    COUNT(DISTINCT IF(counts, month, NULL)) AS months_with,
    SUM(IF(counts, day_share, 0)) AS n_day_share,
    COUNTIF(NOT counts) AS dropped
  FROM cells
  GROUP BY customer_id, sku, mechanic_key, is_monthly
),
per_customer AS (
  SELECT customer_id, mechanic_key, is_monthly, COUNT(DISTINCT month) AS customer_months
  FROM cells
  WHERE counts
  GROUP BY customer_id, mechanic_key, is_monthly
)
SELECT
  cu.customer_name,
  IFNULL(ps.mechanic_key, '(unreadable)') AS mechanic_key,
  IF(ps.is_monthly, 'monthly', 'side offer / other') AS kind,
  COUNTIF(ps.months_with > 0) AS series_with_it,
  COUNTIF(ps.months_with > 0 AND ps.months_with < sm.months) AS series_with_contrast,
  ANY_VALUE(pc.customer_months) AS customer_months,
  ROUND(SUM(IF(ps.months_with > 0 AND ps.months_with < sm.months, ps.n_day_share, 0)), 2) AS n_with_contrast,
  ROUND(SUM(ps.n_day_share), 2) AS n_all,
  SUM(ps.dropped) AS dropped_by_7_days
FROM per_series AS ps
JOIN series_months AS sm USING (customer_id, sku)
JOIN `aire-data.Aire_Data_Analytics.public_customers` AS cu USING (customer_id)
LEFT JOIN per_customer AS pc
  ON pc.customer_id = ps.customer_id
 AND pc.mechanic_key IS NOT DISTINCT FROM ps.mechanic_key
 AND pc.is_monthly = ps.is_monthly
GROUP BY 1, 2, 3
ORDER BY 1, 3, 2;


-- ============================================================
-- C2. Training months with and without a voucher, per customer (the voucher
--     effect is measured by comparing the two). Same "no voucher" words as the
--     backend's voucher_flag; a "Voucher" mechanic also counts as Yes.
-- ============================================================

WITH promo AS (
  SELECT DISTINCT
    cr.customer_id,
    p.promotion_id,
    p.period_start,
    p.period_end,
    (
      LOWER(TRIM(p.promotion_mechanic)) = 'voucher'
      OR LOWER(TRIM(IFNULL(p.voucher, ''))) NOT IN ('', 'no', 'none', 'n/a', 'na', '-', '0')
    ) AS has_voucher
  FROM `aire-data.Aire_Data_Analytics.public_promotions` AS p
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_stores` AS ps ON ps.promotion_id = p.promotion_id
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS s ON s.store_id = ps.store_id
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr ON cr.retailer_id = s.retailer_id
),
voucher_months AS (
  SELECT customer_id, DATE_TRUNC(d, MONTH) AS month, LOGICAL_OR(has_voucher) AS voucher_month
  FROM promo, UNNEST(GENERATE_DATE_ARRAY(period_start, period_end)) AS d
  GROUP BY customer_id, month
),
training_months AS (
  SELECT DISTINCT customer_id, month_year AS month
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
)
SELECT
  cu.customer_name,
  COUNTIF(IFNULL(v.voucher_month, FALSE)) AS months_with_voucher,
  COUNTIF(NOT IFNULL(v.voucher_month, FALSE)) AS months_without_voucher
FROM training_months AS tm
LEFT JOIN voucher_months AS v USING (customer_id, month)
JOIN `aire-data.Aire_Data_Analytics.public_customers` AS cu USING (customer_id)
GROUP BY cu.customer_name
ORDER BY cu.customer_name;


-- ============================================================
-- C3. Store coverage: does a promotion cover the whole customer, or only one
--     channel / some stores? Sales are measured for the whole customer
--     (offline + online summed).
-- ============================================================

WITH window_ AS (
  SELECT MIN(month_year) AS window_start, LAST_DAY(MAX(month_year)) AS window_end
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
),
customer_stores AS (
  SELECT cr.customer_id, COUNT(DISTINCT cr.retailer_id) AS channels, COUNT(DISTINCT s.store_id) AS stores
  FROM `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS s ON s.retailer_id = cr.retailer_id
  GROUP BY cr.customer_id
),
covered AS (
  SELECT
    cr.customer_id,
    p.promotion_id,
    COUNT(DISTINCT cr.retailer_id) AS channels_covered,
    COUNT(DISTINCT s.store_id) AS stores_covered
  FROM `aire-data.Aire_Data_Analytics.public_promotions` AS p
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_stores` AS ps ON ps.promotion_id = p.promotion_id
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS s ON s.store_id = ps.store_id
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr ON cr.retailer_id = s.retailer_id
  CROSS JOIN window_ AS w
  WHERE p.period_end >= w.window_start
    AND p.period_start <= w.window_end
  GROUP BY cr.customer_id, p.promotion_id
)
SELECT
  cu.customer_name,
  COUNT(*) AS promotions,
  COUNTIF(cv.channels_covered = cs.channels) AS all_channels,
  COUNTIF(cv.channels_covered < cs.channels) AS some_channels_only,
  ROUND(AVG(cv.stores_covered / cs.stores), 2) AS avg_store_share,
  ROUND(MIN(cv.stores_covered / cs.stores), 2) AS min_store_share
FROM covered AS cv
JOIN customer_stores AS cs USING (customer_id)
JOIN `aire-data.Aire_Data_Analytics.public_customers` AS cu USING (customer_id)
GROUP BY cu.customer_name
ORDER BY cu.customer_name;


-- ============================================================
-- C4. Data the job would have to skip or treat specially.
-- ============================================================

SELECT
  COUNTIF(promotion_id NOT IN (SELECT promotion_id FROM `aire-data.Aire_Data_Analytics.public_promotion_skus`)) AS promotions_without_skus,
  COUNTIF(promotion_id NOT IN (SELECT promotion_id FROM `aire-data.Aire_Data_Analytics.public_promotion_stores`)) AS promotions_without_stores,
  COUNTIF(period_end < period_start) AS end_before_start,
  COUNTIF(period_start > CURRENT_DATE()) AS future_promotions,
  MAX(period_end) AS latest_period_end
FROM `aire-data.Aire_Data_Analytics.public_promotions`;


-- ============================================================
-- C5. Customer + SKU pairs: promotions vs sales series. Shows pairs that have
--     promotions but no sales series (their promotions can't be measured) and
--     series with no promotion at all.
-- ============================================================

WITH promo_pairs AS (
  SELECT DISTINCT cr.customer_id, psk.sku
  FROM `aire-data.Aire_Data_Analytics.public_promotions` AS p
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_stores` AS ps ON ps.promotion_id = p.promotion_id
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS s ON s.store_id = ps.store_id
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr ON cr.retailer_id = s.retailer_id
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_skus` AS psk ON psk.promotion_id = p.promotion_id
),
series AS (
  SELECT DISTINCT customer_id, sku
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
)
SELECT
  cu.customer_name,
  COALESCE(pp.sku, se.sku) AS sku,
  sk.product_name,
  pp.sku IS NOT NULL AS has_promotions,
  se.sku IS NOT NULL AS has_sales_series
FROM promo_pairs AS pp
FULL OUTER JOIN series AS se
  ON se.customer_id = pp.customer_id AND se.sku = pp.sku
JOIN `aire-data.Aire_Data_Analytics.public_customers` AS cu
  ON cu.customer_id = COALESCE(pp.customer_id, se.customer_id)
LEFT JOIN `aire-data.Aire_Data_Analytics.public_skus` AS sk
  ON sk.sku = COALESCE(pp.sku, se.sku)
WHERE pp.sku IS NULL OR se.sku IS NULL
ORDER BY cu.customer_name, sk.product_name;


-- ============================================================
-- C6. How much of the customer's sales each promotion actually reaches.
--     Every promotion so far covers one channel only (C3), so a month's
--     promotion may touch only part of the customer's sales. These size
--     that, using each store's share of the SKU's sales over the window.
--     Results are split by period_type (week / month) so the two
--     granularities are never added together.
-- ============================================================

-- C6a. Each channel's share of the customer's sales in the window.
WITH window_ AS (
  SELECT MIN(month_year) AS window_start, LAST_DAY(MAX(month_year)) AS window_end
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
)
SELECT
  cu.customer_name,
  r.retailer_name,
  s.period_type,
  ROUND(SUM(s.quantity_units)) AS units,
  ROUND(SUM(s.quantity_units) / SUM(SUM(s.quantity_units)) OVER (PARTITION BY cu.customer_name, s.period_type), 3) AS share_of_customer
FROM `aire-data.Aire_Data_Analytics.public_sellout` AS s
JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr ON cr.retailer_id = s.retailer_id
JOIN `aire-data.Aire_Data_Analytics.public_customers` AS cu ON cu.customer_id = cr.customer_id
JOIN `aire-data.Aire_Data_Analytics.public_retailers` AS r ON r.retailer_id = s.retailer_id
CROSS JOIN window_ AS w
WHERE s.period_start BETWEEN w.window_start AND w.window_end
GROUP BY cu.customer_name, r.retailer_name, s.period_type
ORDER BY cu.customer_name, s.period_type, r.retailer_name;

-- C6b. Per promotion: the share of its SKUs' sales made in the stores it covers.
WITH window_ AS (
  SELECT MIN(month_year) AS window_start, LAST_DAY(MAX(month_year)) AS window_end
  FROM `aire-data.Aire_Data_Analytics.fc_training_input`
),
store_sales AS (
  SELECT cr.customer_id, s.retailer_id, s.store_code, s.sku, s.period_type, SUM(s.quantity_units) AS units
  FROM `aire-data.Aire_Data_Analytics.public_sellout` AS s
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr ON cr.retailer_id = s.retailer_id
  CROSS JOIN window_ AS w
  WHERE s.period_start BETWEEN w.window_start AND w.window_end
  GROUP BY cr.customer_id, s.retailer_id, s.store_code, s.sku, s.period_type
),
covered_stores AS (
  SELECT DISTINCT p.promotion_id, cr.customer_id, st.retailer_id, st.store_code
  FROM `aire-data.Aire_Data_Analytics.public_promotions` AS p
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_stores` AS ps ON ps.promotion_id = p.promotion_id
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS st ON st.store_id = ps.store_id
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS cr ON cr.retailer_id = st.retailer_id
  CROSS JOIN window_ AS w
  WHERE p.period_end >= w.window_start AND p.period_start <= w.window_end
),
promo_skus AS (
  SELECT DISTINCT c.promotion_id, c.customer_id, psk.sku
  FROM (SELECT DISTINCT promotion_id, customer_id FROM covered_stores) AS c
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_skus` AS psk ON psk.promotion_id = c.promotion_id
),
shares AS (
  SELECT
    ps.promotion_id,
    ps.customer_id,
    ss.period_type,
    SUM(IF(cs.store_code IS NOT NULL, ss.units, 0)) AS covered_units,
    SUM(ss.units) AS all_units
  FROM promo_skus AS ps
  JOIN store_sales AS ss ON ss.customer_id = ps.customer_id AND ss.sku = ps.sku
  LEFT JOIN covered_stores AS cs
    ON cs.promotion_id = ps.promotion_id AND cs.retailer_id = ss.retailer_id AND cs.store_code = ss.store_code
  GROUP BY ps.promotion_id, ps.customer_id, ss.period_type
)
SELECT
  cu.customer_name,
  p.promotion_id,
  p.promo_type,
  p.promotion_mechanic,
  p.period_start,
  p.period_end,
  STRING_AGG(DISTINCT r.retailer_name, ', ') AS channels,
  sh.period_type,
  ROUND(SAFE_DIVIDE(sh.covered_units, sh.all_units), 3) AS covered_sales_share
FROM shares AS sh
JOIN `aire-data.Aire_Data_Analytics.public_promotions` AS p ON p.promotion_id = sh.promotion_id
JOIN `aire-data.Aire_Data_Analytics.public_customers` AS cu ON cu.customer_id = sh.customer_id
JOIN covered_stores AS cs ON cs.promotion_id = sh.promotion_id
JOIN `aire-data.Aire_Data_Analytics.public_retailers` AS r ON r.retailer_id = cs.retailer_id
GROUP BY cu.customer_name, p.promotion_id, p.promo_type, p.promotion_mechanic,
         p.period_start, p.period_end, sh.period_type, sh.covered_units, sh.all_units
ORDER BY cu.customer_name, p.period_start, p.promotion_id, sh.period_type;
