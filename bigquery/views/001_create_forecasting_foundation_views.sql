  -- Reusable BigQuery analytics views for sales, promotions, and inventory.
  --
  -- Project: aire-data
  -- Dataset: Aire_Data_Analytics
  -- Datastream-replicated public_* tables and analytical views live together in
  -- this dataset, isolated from the legacy objects in Aire_Data.
  --
  -- This script only creates or replaces views. It does not mutate any of the
  -- Datastream-replicated public_* tables.

  -- Stop before creating anything if the separately validated inventory view
  -- does not expose the three keys required by the monthly foundation.
  ASSERT (
    SELECT COUNT(DISTINCT column_name) = 3
    FROM `aire-data.Aire_Data_Analytics.INFORMATION_SCHEMA.COLUMNS`
    WHERE table_name = 'v_inventory_history'
      AND column_name IN ('customer_id', 'sku', 'period_start')
  ) AS 'v_inventory_history must contain customer_id, sku, and period_start';

  -- ---------------------------------------------------------------------------
  -- 1. Sales with its one-to-one catalog descriptions.
  --    Grain remains the sellout business key.
  -- ---------------------------------------------------------------------------
  CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.v_sales_enriched` AS
  SELECT
    so.retailer_id,
    retailer.retailer_name,
    so.store_code,
    store.store_id,
    store.store_name,
    store.store_format,
    so.sku,
    product.sku_range,
    product.product_name,
    product.size,
    product.brand,
    product.uom,
    product.pack_size,
    product.price,
    so.period_start,
    so.period_end,
    so.period_type,
    so.quantity_units,
  'cartons' AS quantity_unit,
    so.revenue,
    so.source_file,
    so.loaded_at,
    so.data_source
  FROM `aire-data.Aire_Data_Analytics.public_sellout` AS so
  JOIN `aire-data.Aire_Data_Analytics.public_retailers` AS retailer
    ON retailer.retailer_id = so.retailer_id
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS store
    ON store.retailer_id = so.retailer_id
  AND store.store_code = so.store_code
  JOIN `aire-data.Aire_Data_Analytics.public_skus` AS product
    ON product.sku = so.sku;


  -- ---------------------------------------------------------------------------
  -- 2. Sales at the same customer + SKU + month grain as combined inventory.
  --    Online/offline values are retained as separate columns as well as totals.
  --
  --    When monthly and weekly facts overlap for a retailer + calendar month,
  --    monthly facts are authoritative. Weekly facts are used only for months
  --    without monthly coverage. This mirrors Cloud SQL's effective sell-out
  --    rule and prevents the two granularities from being added together.
  --    A retained weekly fact belongs to the month containing period_start.
  -- ---------------------------------------------------------------------------
  CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.v_customer_monthly_sales` AS
  WITH sales_with_month AS (
    SELECT
      sales.*,
      DATE_TRUNC(sales.period_start, MONTH) AS sales_month
    FROM `aire-data.Aire_Data_Analytics.v_sales_enriched` AS sales
  ),
  monthly_coverage AS (
    SELECT DISTINCT
      retailer_id,
      sales_month
    FROM sales_with_month
    WHERE period_type = 'month'
  ),
  effective_sales AS (
    SELECT sales.*
    FROM sales_with_month AS sales
    WHERE sales.period_type = 'month'

    UNION ALL

    SELECT sales.*
    FROM sales_with_month AS sales
    WHERE sales.period_type = 'week'
      AND NOT EXISTS (
        SELECT 1
        FROM monthly_coverage AS coverage
        WHERE coverage.retailer_id = sales.retailer_id
          AND coverage.sales_month = sales.sales_month
      )
  )
  SELECT
    customer.customer_id,
    customer.customer_name,
    sales.sku,
    ANY_VALUE(sales.sku_range) AS sku_range,
    ANY_VALUE(sales.product_name) AS product_name,
    ANY_VALUE(sales.size) AS size,
    ANY_VALUE(sales.brand) AS brand,
    ANY_VALUE(sales.uom) AS uom,
    ANY_VALUE(sales.pack_size) AS pack_size,
    ANY_VALUE(sales.price) AS price,
    sales.sales_month AS period_start,
    LAST_DAY(sales.sales_month, MONTH) AS period_end,
    SUM(sales.quantity_units) AS quantity_cartons,
    SUM(sales.revenue) AS revenue,
    SUM(IF(sales.retailer_name = 'fairprice_online', sales.quantity_units, 0))
    AS online_quantity_cartons,
    SUM(IF(sales.retailer_name = 'fairprice_offline', sales.quantity_units, 0))
    AS offline_quantity_cartons,
    SUM(IF(sales.retailer_name = 'fairprice_online', sales.revenue, 0))
      AS online_revenue,
    SUM(IF(sales.retailer_name = 'fairprice_offline', sales.revenue, 0))
      AS offline_revenue,
    COUNT(*) AS source_sales_row_count,
    COUNT(DISTINCT sales.store_id) AS selling_store_count,
    ARRAY_AGG(
      DISTINCT sales.retailer_name
      IGNORE NULLS
      ORDER BY sales.retailer_name
    ) AS retailer_channels,
    ARRAY_AGG(
      DISTINCT sales.period_type
      IGNORE NULLS
      ORDER BY sales.period_type
    ) AS source_period_types,
    ARRAY_AGG(
      DISTINCT sales.source_file
      IGNORE NULLS
      ORDER BY sales.source_file
    ) AS source_files,
    MAX(sales.loaded_at) AS latest_sales_loaded_at
  FROM effective_sales AS sales
  JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS bridge
    ON bridge.retailer_id = sales.retailer_id
  JOIN `aire-data.Aire_Data_Analytics.public_customers` AS customer
    ON customer.customer_id = bridge.customer_id
  GROUP BY
    customer.customer_id,
    customer.customer_name,
    sales.sku,
    sales.sales_month;


  -- ---------------------------------------------------------------------------
  -- 3. Full promotion event detail.
  --    Intentional grain: one promotion + store + SKU relationship.
  --    This view preserves all fields but must not be summed as if it were sales.
  -- ---------------------------------------------------------------------------
  CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.v_promotion_events_enriched` AS
  SELECT
    promotion.promotion_id,
    promotion.period_start,
    promotion.period_end,
    promotion.period_label,
    promotion.promo_type,
    promotion.promotion_mechanic,
    promotion.voucher,
    promotion.created_at,
    promotion.updated_at,
    promotion_sku.sku,
    promotion_sku.quantity_units AS promotion_quantity_units,
    product.sku_range,
    product.product_name,
    product.size,
    product.brand,
    product.uom,
    product.pack_size,
    product.price,
    store.store_id,
    store.store_code,
    store.store_name,
    store.store_format,
    retailer.retailer_id,
    retailer.retailer_name,
    customer.customer_id,
    customer.customer_name
  FROM `aire-data.Aire_Data_Analytics.public_promotions` AS promotion
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_skus` AS promotion_sku
    ON promotion_sku.promotion_id = promotion.promotion_id
  JOIN `aire-data.Aire_Data_Analytics.public_skus` AS product
    ON product.sku = promotion_sku.sku
  JOIN `aire-data.Aire_Data_Analytics.public_promotion_stores` AS promotion_store
    ON promotion_store.promotion_id = promotion.promotion_id
  JOIN `aire-data.Aire_Data_Analytics.public_stores` AS store
    ON store.store_id = promotion_store.store_id
  JOIN `aire-data.Aire_Data_Analytics.public_retailers` AS retailer
    ON retailer.retailer_id = store.retailer_id
  LEFT JOIN `aire-data.Aire_Data_Analytics.public_customer_retailers` AS bridge
    ON bridge.retailer_id = retailer.retailer_id
  LEFT JOIN `aire-data.Aire_Data_Analytics.public_customers` AS customer
    ON customer.customer_id = bridge.customer_id;


  -- ---------------------------------------------------------------------------
  -- 4. Complete promotion features at customer + SKU + month grain.
  --    Events are deduplicated from their store fan-out before event attributes
  --    are counted. Store coverage is calculated separately.
  -- ---------------------------------------------------------------------------
  CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.v_promotion_features_monthly` AS
  WITH event_months AS (
    SELECT DISTINCT
      event.customer_id,
      event.customer_name,
      event.sku,
      event.promotion_id,
      event.period_start AS promotion_period_start,
      event.period_end AS promotion_period_end,
      event.period_label,
      event.promo_type,
      event.promotion_mechanic,
      event.voucher,
      event.promotion_quantity_units,
      month_start
    FROM `aire-data.Aire_Data_Analytics.v_promotion_events_enriched` AS event
    CROSS JOIN UNNEST(
      GENERATE_DATE_ARRAY(
        DATE_TRUNC(event.period_start, MONTH),
        DATE_TRUNC(event.period_end, MONTH),
        INTERVAL 1 MONTH
      )
    ) AS month_start
    WHERE event.customer_id IS NOT NULL
  ),
  promotion_days AS (
    SELECT
      event.customer_id,
      event.sku,
      event.month_start,
      COUNT(DISTINCT promotion_day) AS promotion_days
    FROM event_months AS event
    CROSS JOIN UNNEST(
      GENERATE_DATE_ARRAY(
        GREATEST(event.promotion_period_start, event.month_start),
        LEAST(event.promotion_period_end, LAST_DAY(event.month_start, MONTH)),
        INTERVAL 1 DAY
      )
    ) AS promotion_day
    GROUP BY event.customer_id, event.sku, event.month_start
  ),
  event_features AS (
    SELECT
      customer_id,
      ANY_VALUE(customer_name) AS customer_name,
      sku,
      month_start AS period_start,
      LAST_DAY(month_start, MONTH) AS period_end,
      TRUE AS promotion_active,
      COUNT(DISTINCT promotion_id) AS promotion_count,
      MIN(promotion_period_start) AS earliest_promotion_start,
      MAX(promotion_period_end) AS latest_promotion_end,
      ARRAY_AGG(
        DISTINCT promotion_id
        ORDER BY promotion_id
      ) AS promotion_ids,
      ARRAY_AGG(
        DISTINCT period_label
        IGNORE NULLS
        ORDER BY period_label
      ) AS promotion_period_labels,
      ARRAY_AGG(
        DISTINCT promo_type
        IGNORE NULLS
        ORDER BY promo_type
      ) AS promotion_types,
      ARRAY_AGG(
        DISTINCT promotion_mechanic
        IGNORE NULLS
        ORDER BY promotion_mechanic
      ) AS promotion_mechanics,
      ARRAY_AGG(
        DISTINCT voucher
        IGNORE NULLS
        ORDER BY voucher
      ) AS vouchers,
      SUM(promotion_quantity_units) AS promotion_quantity_units_sum
    FROM event_months
    GROUP BY customer_id, sku, month_start
  ),
  store_months AS (
    SELECT DISTINCT
      event.customer_id,
      event.sku,
      event.store_id,
      event.store_code,
      event.store_format,
      event.retailer_id,
      event.retailer_name,
      month_start
    FROM `aire-data.Aire_Data_Analytics.v_promotion_events_enriched` AS event
    CROSS JOIN UNNEST(
      GENERATE_DATE_ARRAY(
        DATE_TRUNC(event.period_start, MONTH),
        DATE_TRUNC(event.period_end, MONTH),
        INTERVAL 1 MONTH
      )
    ) AS month_start
    WHERE event.customer_id IS NOT NULL
  ),
  store_features AS (
    SELECT
      customer_id,
      sku,
      month_start,
      COUNT(DISTINCT store_id) AS promoted_store_count,
      ARRAY_AGG(DISTINCT store_id ORDER BY store_id) AS promoted_store_ids,
      ARRAY_AGG(
        DISTINCT store_code
        IGNORE NULLS
        ORDER BY store_code
      ) AS promoted_store_codes,
      ARRAY_AGG(
        DISTINCT store_format
        IGNORE NULLS
        ORDER BY store_format
      ) AS promoted_store_formats,
      ARRAY_AGG(DISTINCT retailer_id ORDER BY retailer_id) AS retailer_ids,
      ARRAY_AGG(
        DISTINCT retailer_name
        IGNORE NULLS
        ORDER BY retailer_name
      ) AS retailer_names
    FROM store_months
    GROUP BY customer_id, sku, month_start
  ),
  customer_store_counts AS (
    SELECT
      bridge.customer_id,
      COUNT(DISTINCT store.store_id) AS customer_store_count
    FROM `aire-data.Aire_Data_Analytics.public_customer_retailers` AS bridge
    JOIN `aire-data.Aire_Data_Analytics.public_stores` AS store
      ON store.retailer_id = bridge.retailer_id
    GROUP BY bridge.customer_id
  )
  SELECT
    event.customer_id,
    event.customer_name,
    event.sku,
    event.period_start,
    event.period_end,
    event.promotion_active,
    event.promotion_count,
    days.promotion_days,
    event.earliest_promotion_start,
    event.latest_promotion_end,
    event.promotion_ids,
    event.promotion_period_labels,
    event.promotion_types,
    event.promotion_mechanics,
    event.vouchers,
    event.promotion_quantity_units_sum,
    stores.promoted_store_count,
    store_count.customer_store_count,
    SAFE_DIVIDE(
      stores.promoted_store_count,
      store_count.customer_store_count
    ) AS promoted_store_coverage,
    stores.promoted_store_ids,
    stores.promoted_store_codes,
    stores.promoted_store_formats,
    stores.retailer_ids,
    stores.retailer_names
  FROM event_features AS event
  JOIN promotion_days AS days
    ON days.customer_id = event.customer_id
  AND days.sku = event.sku
  AND days.month_start = event.period_start
  JOIN store_features AS stores
    ON stores.customer_id = event.customer_id
  AND stores.sku = event.sku
  AND stores.month_start = event.period_start
  JOIN customer_store_counts AS store_count
    ON store_count.customer_id = event.customer_id;


  -- ---------------------------------------------------------------------------
  -- 5. Comprehensive monthly foundation.
  --
  --    The three domains stay in nested STRUCT columns. This retains all fields,
  --    makes their origin explicit, and prevents consumers from accidentally
  --    summing a fan-out join. A later model-specific view can flatten exactly
  --    the fields needed for that model.
  -- ---------------------------------------------------------------------------
  CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.v_forecasting_foundation_monthly` AS
  WITH month_keys AS (
    SELECT customer_id, sku, period_start
    FROM `aire-data.Aire_Data_Analytics.v_customer_monthly_sales`

    UNION DISTINCT

    SELECT customer_id, sku, period_start
    FROM `aire-data.Aire_Data_Analytics.v_promotion_features_monthly`

    UNION DISTINCT

    SELECT customer_id, sku, period_start
    FROM `aire-data.Aire_Data_Analytics.v_inventory_history`
  )
  SELECT
    month_key.customer_id,
    customer.customer_name,
    month_key.sku,
    product.sku_range,
    product.product_name,
    product.size,
    product.brand,
    product.uom,
    product.pack_size,
    product.price,
    month_key.period_start,
    LAST_DAY(month_key.period_start, MONTH) AS period_end,
    target.target_doh,
    target.effective_from AS target_doh_effective_from,
    target.effective_to AS target_doh_effective_to,
    target.source AS target_doh_source,
    sales.customer_id IS NOT NULL AS has_sales,
    promotion.customer_id IS NOT NULL AS has_promotion,
    inventory.customer_id IS NOT NULL AS has_inventory,
    sales,
    promotion,
    inventory
  FROM month_keys AS month_key
  JOIN `aire-data.Aire_Data_Analytics.public_customers` AS customer
    ON customer.customer_id = month_key.customer_id
  JOIN `aire-data.Aire_Data_Analytics.public_skus` AS product
    ON product.sku = month_key.sku
  LEFT JOIN `aire-data.Aire_Data_Analytics.v_customer_monthly_sales` AS sales
    ON sales.customer_id = month_key.customer_id
  AND sales.sku = month_key.sku
  AND sales.period_start = month_key.period_start
  LEFT JOIN `aire-data.Aire_Data_Analytics.v_promotion_features_monthly` AS promotion
    ON promotion.customer_id = month_key.customer_id
  AND promotion.sku = month_key.sku
  AND promotion.period_start = month_key.period_start
  LEFT JOIN `aire-data.Aire_Data_Analytics.v_inventory_history` AS inventory
    ON inventory.customer_id = month_key.customer_id
  AND inventory.sku = month_key.sku
  AND inventory.period_start = month_key.period_start
  LEFT JOIN `aire-data.Aire_Data_Analytics.public_customer_doh_targets` AS target
    ON target.customer_id = month_key.customer_id
  AND month_key.period_start >= target.effective_from
  AND (
    target.effective_to IS NULL
    OR month_key.period_start <= target.effective_to
  )
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY month_key.customer_id, month_key.sku, month_key.period_start
    ORDER BY target.effective_from DESC
  ) = 1;
