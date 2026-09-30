-- Reconstruct monthly FairPrice inventory history from replicated metric rows.
--
-- Project: aire-data
-- Dataset: Aire_Data_Analytics
-- Grain: customer + SKU + month
--
-- Safe to rerun: this script only creates or replaces a BigQuery view.

CREATE OR REPLACE VIEW `aire-data.Aire_Data_Analytics.v_inventory_history` AS
WITH latest_snapshot AS (
  SELECT
    customer_id,
    sku,
    period_start,
    period_end,
    metric_name,
    metric_value,
    value_type,
    as_of_date,
    loaded_at
  FROM `aire-data.Aire_Data_Analytics.public_inventory_metrics`
  WHERE
    (metric_name = 'opening_inventory' AND value_type = 'derived')
    OR (metric_name = 'sell_in' AND value_type = 'actual')
    OR (metric_name = 'sell_out_base' AND value_type = 'actual')
    OR (
      metric_name = 'sell_out_building_blocks'
      AND value_type = 'manual_plan'
    )
    OR (metric_name = 'doh' AND value_type = 'derived')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_id, sku, period_start, metric_name
    ORDER BY as_of_date DESC, loaded_at DESC
  ) = 1
),

monthly_metrics AS (
  SELECT
    customer_id,
    sku,
    period_start,
    MAX(period_end) AS period_end,
    MAX(IF(
      metric_name = 'opening_inventory',
      metric_value,
      NULL
    )) AS source_opening_inventory,
    MAX(IF(
      metric_name = 'sell_in',
      metric_value,
      NULL
    )) AS sell_in,
    MAX(IF(
      metric_name = 'sell_out_base',
      metric_value,
      NULL
    )) AS sell_out_base,
    MAX(IF(
      metric_name = 'sell_out_building_blocks',
      metric_value,
      NULL
    )) AS sell_out_building_blocks,
    MAX(IF(
      metric_name = 'doh',
      metric_value,
      NULL
    )) AS source_doh,
    MAX(as_of_date) AS as_of_date
  FROM latest_snapshot
  GROUP BY customer_id, sku, period_start
),

initial_inventory AS (
  SELECT
    customer_id,
    sku,
    COALESCE(source_opening_inventory, 0) AS initial_opening_inventory
  FROM monthly_metrics
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_id, sku
    ORDER BY period_start
  ) = 1
),

monthly_flows AS (
  SELECT
    monthly.*,
    COALESCE(monthly.sell_in, 0)
      - COALESCE(monthly.sell_out_base, 0)
      - COALESCE(monthly.sell_out_building_blocks, 0)
      AS net_inventory_change
  FROM monthly_metrics AS monthly
),

calculated_inventory AS (
  SELECT
    monthly.*,
    initial.initial_opening_inventory
      + COALESCE(
        SUM(monthly.net_inventory_change) OVER (
          PARTITION BY monthly.customer_id, monthly.sku
          ORDER BY monthly.period_start
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      ) AS calculated_opening_inventory,
    initial.initial_opening_inventory
      + SUM(monthly.net_inventory_change) OVER (
        PARTITION BY monthly.customer_id, monthly.sku
        ORDER BY monthly.period_start
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS calculated_ending_inventory
  FROM monthly_flows AS monthly
  JOIN initial_inventory AS initial
    USING (customer_id, sku)
)

SELECT
  inventory.customer_id,
  customer.customer_name,
  inventory.sku,
  product.sku_range,
  product.product_name,
  product.size,
  product.brand,
  product.uom,
  product.pack_size,
  inventory.period_start,
  inventory.period_end,
  inventory.source_opening_inventory,
  inventory.calculated_opening_inventory,
  COALESCE(inventory.sell_in, 0) AS actual_sell_in,
  COALESCE(inventory.sell_out_base, 0) AS actual_sell_out_base,
  COALESCE(
    inventory.sell_out_building_blocks,
    0
  ) AS sell_out_building_blocks,
  COALESCE(inventory.sell_out_base, 0)
    + COALESCE(inventory.sell_out_building_blocks, 0)
    AS total_sell_out,
  inventory.net_inventory_change,
  inventory.calculated_ending_inventory,
  inventory.source_doh,
  inventory.source_opening_inventory
    - inventory.calculated_opening_inventory
    AS opening_inventory_variance,
  inventory.as_of_date
FROM calculated_inventory AS inventory
JOIN `aire-data.Aire_Data_Analytics.public_customers` AS customer
  USING (customer_id)
LEFT JOIN `aire-data.Aire_Data_Analytics.public_skus` AS product
  USING (sku);
