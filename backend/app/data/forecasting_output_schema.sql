-- Model output only. Actuals come from
-- aire-data.Aire_Data_Analytics.v_customer_monthly_sales.
-- Promos come from Postgres promotions / promotion_skus / promotion_stores.
--
-- Swap later via .env.backend BQ_FORECAST_TABLE only.
--
-- run_type:
--   'rolling'  12-months-ahead run, one new run per complete actual month
--   'yearly'   frozen Jan-Dec baseline
-- tier:
--   0  this app's pl_forecast.py model
--   1  teammate model (not loaded yet)
-- NULL run_type / tier on old rows is treated as rolling / 0 in the API.

CREATE TABLE `aire-data.Aire_Data.forecasting_output_xianhui_mock` (
  month_year DATE NOT NULL,
  forecast_generated_at DATE,
  run_type STRING,
  tier INT64,
  customer_id INT64 NOT NULL,
  customer_name STRING NOT NULL,
  product_name STRING NOT NULL,
  predicted_quantity_units FLOAT64,
  predicted_revenue FLOAT64
);
