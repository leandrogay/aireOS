-- Paste in BigQuery (aire-data / Aire_Data).
-- Swap later via .env.backend BQ_FORECAST_TABLE only.
-- customer_name is the combined retailer family (fairprice_offline +
-- fairprice_online → fairprice). Promo columns are null when the month
-- has no promotion. Forecasted revenue uses forecasting_sku_price.

CREATE TABLE `aire-data.Aire_Data.forecasting_output_xianhui_mock` (
  month_year DATE NOT NULL,
  forecast_generated_at DATE,
  customer_id INT64 NOT NULL,
  customer_name STRING NOT NULL,
  product_name STRING NOT NULL,
  promo_type STRING,
  promotion_mechanic STRING,
  period_label STRING,
  voucher STRING,
  quantity_units FLOAT64,
  predicted_quantity_units FLOAT64,
  revenue FLOAT64,
  predicted_revenue FLOAT64
);
