-- List price per SKU. Forecasted revenue = predicted_quantity_units * price.
-- Actual revenue stays the Excel sell-out sum, not price × qty.

CREATE TABLE `aire-data.Aire_Data.forecasting_sku_price` (
  product_name STRING NOT NULL,
  price FLOAT64 NOT NULL
);
