-- READ-ONLY checks for the promotion uplift measurement job (Stage 2), for the
-- Cloud SQL `aireos` database on aireos-postgresql (Cloud SQL Studio, or
-- psql). Every block is a SELECT; nothing is created, changed or deleted.
-- Run each block separately and paste the results back.
--
-- FALLBACK ONLY: the same checks run in BigQuery against the Datastream copies
-- (promo_measurement_checks_bigquery_promotions.sql), which is the version to
-- use. This one is for when those copies are missing or stale.
--
-- BEFORE RUNNING C1-C3: set window_start / window_end in the `params` line of
-- each block to B1a's window_start / window_end from the BigQuery checks.
--
-- Mechanic keys are worked out with the same pattern rules as the backend's
-- promo_uplift_rules.mechanic_key, written in SQL. One small difference: the
-- backend treats "25.0%" and "25%" as the same key; this SQL does not.


-- ============================================================
-- C0. Promotions overall: mechanics as typed, the key each one gets, and
--     whether the key is readable. Expect no NULL keys (Section 2 of the
--     design found every label readable on 21 Oct 2026).
-- ============================================================

WITH labels AS (
    SELECT
        promotion_mechanic,
        promo_type,
        btrim(regexp_replace(regexp_replace(lower(promotion_mechanic), '\s+', ' ', 'g'), '\s*%\s*', '% ', 'g')) AS t
    FROM promotions
)
SELECT
    promotion_mechanic,
    promo_type,
    CASE
        WHEN t ~ '^voucher$' THEN 'voucher'
        WHEN t ~ '^b\d+g\d+$' THEN regexp_replace(t, '^b(\d+)g(\d+)$', 'b\1g\2')
        WHEN t ~ '^buy \d+ get \d+ free$' THEN regexp_replace(t, '^buy (\d+) get (\d+) free$', 'b\1g\2')
        WHEN t ~ '^buy \d+ get \d+(\.\d+)?% ?(off)?$' THEN regexp_replace(t, '^buy (\d+) get (\d+(\.\d+)?)% ?(off)?$', 'b\1_pct_off_\2')
        WHEN t ~ '^\d+(\.\d+)?% ?(off)?$' THEN regexp_replace(t, '^(\d+(\.\d+)?)% ?(off)?$', 'pct_off_\1')
    END AS mechanic_key,
    COUNT(*) AS promotions
FROM labels
GROUP BY promotion_mechanic, promo_type, t
ORDER BY mechanic_key NULLS FIRST, promotion_mechanic;


-- ============================================================
-- C1. Months of evidence per customer + mechanic, with the day-share rule.
--     One row per customer x mechanic:
--       customer_months   distinct months the customer ran it (candidate N)
--       sku_months        distinct SKU x month pairs (cells n is summed over)
--       sum_day_share     those cells weighted by the share of the month run
--                         (candidate n, summed over the customer's SKUs)
--       dropped_by_7_days side-offer SKU-months under 7 days in that month
--     Day shares here are raw (a side offer's days are NOT yet taken away
--     from the monthly promotion it replaces); the job will do that.
-- ============================================================

WITH params AS (
    SELECT DATE '2025-01-01' AS window_start, DATE '2026-08-01' AS window_end, 7 AS side_offer_min_days
),
promo AS (
    SELECT DISTINCT
        cr.customer_id,
        c.customer_name,
        psk.sku,
        p.promotion_id,
        regexp_replace(p.promo_type::text, '^carton_', '') = 'monthly' AS is_monthly,
        p.period_start,
        p.period_end,
        btrim(regexp_replace(regexp_replace(lower(p.promotion_mechanic), '\s+', ' ', 'g'), '\s*%\s*', '% ', 'g')) AS t
    FROM promotions p
    JOIN promotion_stores ps ON ps.promotion_id = p.promotion_id
    JOIN stores s ON s.store_id = ps.store_id
    JOIN customer_retailers cr ON cr.retailer_id = s.retailer_id
    JOIN customers c ON c.customer_id = cr.customer_id
    JOIN promotion_skus psk ON psk.promotion_id = p.promotion_id
),
keyed AS (
    SELECT
        promo.*,
        CASE
            WHEN t ~ '^voucher$' THEN 'voucher'
            WHEN t ~ '^b\d+g\d+$' THEN regexp_replace(t, '^b(\d+)g(\d+)$', 'b\1g\2')
            WHEN t ~ '^buy \d+ get \d+ free$' THEN regexp_replace(t, '^buy (\d+) get (\d+) free$', 'b\1g\2')
            WHEN t ~ '^buy \d+ get \d+(\.\d+)?% ?(off)?$' THEN regexp_replace(t, '^buy (\d+) get (\d+(\.\d+)?)% ?(off)?$', 'b\1_pct_off_\2')
            WHEN t ~ '^\d+(\.\d+)?% ?(off)?$' THEN regexp_replace(t, '^(\d+(\.\d+)?)% ?(off)?$', 'pct_off_\1')
        END AS mechanic_key
    FROM promo
),
days AS (
    SELECT
        k.customer_id,
        k.customer_name,
        k.sku,
        k.mechanic_key,
        k.is_monthly,
        date_trunc('month', d)::date AS month,
        COUNT(DISTINCT d::date) AS days_run
    FROM keyed k
    CROSS JOIN LATERAL generate_series(k.period_start, k.period_end, INTERVAL '1 day') AS d
    GROUP BY k.customer_id, k.customer_name, k.sku, k.mechanic_key, k.is_monthly, date_trunc('month', d)
),
shares AS (
    SELECT
        days.*,
        days_run::numeric / EXTRACT(DAY FROM (month + INTERVAL '1 month' - INTERVAL '1 day')) AS day_share,
        (is_monthly OR days_run >= params.side_offer_min_days) AS counts
    FROM days, params
    WHERE month BETWEEN params.window_start AND params.window_end
)
SELECT
    customer_name,
    COALESCE(mechanic_key, '(unreadable)') AS mechanic_key,
    CASE WHEN is_monthly THEN 'monthly' ELSE 'side offer / other' END AS kind,
    COUNT(DISTINCT month) FILTER (WHERE counts) AS customer_months,
    COUNT(*) FILTER (WHERE counts) AS sku_months,
    ROUND(SUM(day_share) FILTER (WHERE counts), 2) AS sum_day_share,
    COUNT(*) FILTER (WHERE NOT counts) AS dropped_by_7_days,
    ROUND(MIN(day_share), 2) AS min_day_share,
    ROUND(MAX(day_share), 2) AS max_day_share
FROM shares
GROUP BY customer_name, mechanic_key, is_monthly
ORDER BY customer_name, kind, mechanic_key;


-- ============================================================
-- C2. Voucher months per customer: months with a voucher vs without (the
--     voucher measurement compares the two). Same "no voucher" words as the
--     backend's voucher_flag; a "Voucher" mechanic also counts as Yes.
-- ============================================================

WITH params AS (
    SELECT DATE '2025-01-01' AS window_start, DATE '2026-08-01' AS window_end
),
promo AS (
    SELECT DISTINCT
        cr.customer_id,
        c.customer_name,
        p.promotion_id,
        p.period_start,
        p.period_end,
        (
            lower(btrim(p.promotion_mechanic)) = 'voucher'
            OR lower(btrim(COALESCE(p.voucher, ''))) NOT IN ('', 'no', 'none', 'n/a', 'na', '-', '0')
        ) AS has_voucher
    FROM promotions p
    JOIN promotion_stores ps ON ps.promotion_id = p.promotion_id
    JOIN stores s ON s.store_id = ps.store_id
    JOIN customer_retailers cr ON cr.retailer_id = s.retailer_id
    JOIN customers c ON c.customer_id = cr.customer_id
),
months AS (
    SELECT
        customer_name,
        date_trunc('month', d)::date AS month,
        bool_or(has_voucher) AS voucher_month
    FROM promo
    CROSS JOIN LATERAL generate_series(period_start, period_end, INTERVAL '1 day') AS d
    GROUP BY customer_name, date_trunc('month', d)
)
SELECT
    customer_name,
    COUNT(*) FILTER (WHERE voucher_month) AS months_with_voucher,
    COUNT(*) FILTER (WHERE NOT voucher_month) AS months_without_voucher
FROM months, params
WHERE month BETWEEN params.window_start AND params.window_end
GROUP BY customer_name
ORDER BY customer_name;


-- ============================================================
-- C3. Store coverage (question 14): does a promotion cover the whole
--     customer, or only one channel / some stores? The sales the job measures
--     are the whole customer (offline + online summed).
-- ============================================================

WITH params AS (
    SELECT DATE '2025-01-01' AS window_start, DATE '2026-08-01' AS window_end
),
customer_stores AS (
    SELECT cr.customer_id, COUNT(DISTINCT cr.retailer_id) AS channels, COUNT(DISTINCT s.store_id) AS stores
    FROM customer_retailers cr
    JOIN stores s ON s.retailer_id = cr.retailer_id
    GROUP BY cr.customer_id
),
covered AS (
    SELECT
        cr.customer_id,
        p.promotion_id,
        COUNT(DISTINCT cr.retailer_id) AS channels_covered,
        COUNT(DISTINCT s.store_id) AS stores_covered
    FROM promotions p
    JOIN promotion_stores ps ON ps.promotion_id = p.promotion_id
    JOIN stores s ON s.store_id = ps.store_id
    JOIN customer_retailers cr ON cr.retailer_id = s.retailer_id
    CROSS JOIN params
    WHERE p.period_end >= params.window_start
      AND p.period_start < params.window_end + INTERVAL '1 month'
    GROUP BY cr.customer_id, p.promotion_id
)
SELECT
    c.customer_name,
    COUNT(*) AS promotions,
    COUNT(*) FILTER (WHERE cv.channels_covered = cs.channels) AS all_channels,
    COUNT(*) FILTER (WHERE cv.channels_covered < cs.channels) AS some_channels_only,
    ROUND(AVG(cv.stores_covered::numeric / cs.stores), 2) AS avg_store_share,
    ROUND(MIN(cv.stores_covered::numeric / cs.stores), 2) AS min_store_share
FROM covered cv
JOIN customer_stores cs ON cs.customer_id = cv.customer_id
JOIN customers c ON c.customer_id = cv.customer_id
GROUP BY c.customer_name
ORDER BY c.customer_name;


-- ============================================================
-- C4. Data the job would have to skip or treat specially.
-- ============================================================

SELECT
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM promotion_skus psk WHERE psk.promotion_id = p.promotion_id)) AS promotions_without_skus,
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM promotion_stores ps WHERE ps.promotion_id = p.promotion_id)) AS promotions_without_stores,
    COUNT(*) FILTER (WHERE p.period_end < p.period_start) AS end_before_start,
    COUNT(*) FILTER (WHERE p.period_start > (now() AT TIME ZONE 'UTC')::date) AS future_promotions,
    MAX(p.period_end) AS latest_period_end
FROM promotions p;


-- ============================================================
-- C5. Customer + SKU pairs that have promotions, to compare with B1b's
--     series from BigQuery (same customer_id and sku codes on both sides).
-- ============================================================

SELECT DISTINCT
    cr.customer_id,
    c.customer_name,
    psk.sku,
    sk.product_name,
    sk.is_active
FROM promotions p
JOIN promotion_stores ps ON ps.promotion_id = p.promotion_id
JOIN stores s ON s.store_id = ps.store_id
JOIN customer_retailers cr ON cr.retailer_id = s.retailer_id
JOIN customers c ON c.customer_id = cr.customer_id
JOIN promotion_skus psk ON psk.promotion_id = p.promotion_id
LEFT JOIN skus sk ON sk.sku = psk.sku
ORDER BY c.customer_name, sk.product_name;
