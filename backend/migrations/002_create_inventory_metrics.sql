-- To run this migration in Cloud SQL.

-- Sales and promotions are recorded per retailer channel, while inventory is
-- supplied at the combined customer level. The customer_retailers bridge maps
-- fairprice_online and fairprice_offline to one FairPrice inventory customer.
--
-- Inventory values can arrive late or change from a plan into an actual. Each
-- metric is therefore stored with its own value type and as-of date so later
-- actuals do not destroy the forecasts that preceded them.
BEGIN;

CREATE TABLE IF NOT EXISTS customers (
    customer_id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_retailers (
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
    retailer_id INTEGER NOT NULL REFERENCES retailers(retailer_id),
    PRIMARY KEY (customer_id, retailer_id),
    CONSTRAINT uq_customer_retailers_retailer UNIQUE (retailer_id)
);

CREATE TABLE IF NOT EXISTS inventory_metric_types (
    metric_name VARCHAR(100) PRIMARY KEY,
    unit VARCHAR(30) NOT NULL,
    description TEXT NOT NULL
);

INSERT INTO inventory_metric_types (metric_name, unit, description)
VALUES
    ('opening_inventory', 'cartons', 'Inventory cartons available at the start of the period.'),
    ('sell_in', 'cartons', 'Cartons supplied to the customer during the period.'),
    ('sell_out_base', 'cartons', 'Base sell-out cartons excluding building blocks.'),
    ('sell_out_building_blocks', 'cartons', 'Manual incremental sell-out cartons allocated for known business activities.'),
    ('closing_inventory', 'cartons', 'Inventory cartons remaining at the end of the period.'),
    ('forecasted_daily_sellout_rate', 'cartons_per_day', 'Forecasted average sell-out cartons per day.'),
    ('doh', 'days', 'Days of inventory on hand.')
ON CONFLICT (metric_name) DO UPDATE SET
    unit = EXCLUDED.unit,
    description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS inventory_metrics (
    inventory_metric_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
    sku VARCHAR(100) NOT NULL REFERENCES skus(sku),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    metric_name VARCHAR(100) NOT NULL
        REFERENCES inventory_metric_types(metric_name),
    metric_value DOUBLE PRECISION NOT NULL,
    value_type VARCHAR(30) NOT NULL,
    as_of_date DATE NOT NULL,
    source_file VARCHAR(255),
    source_sheet VARCHAR(255),
    source_cell VARCHAR(32),
    source_formula TEXT,
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_source VARCHAR(100) NOT NULL DEFAULT 'inventory_workbook',
    CONSTRAINT ck_inventory_metrics_period
        CHECK (period_end >= period_start),
    CONSTRAINT ck_inventory_metrics_value_type
        CHECK (
            value_type IN (
                'actual',
                'manual_plan',
                'manual_forecast',
                'model_forecast',
                'recommended',
                'derived'
            )
        ),
    CONSTRAINT uq_inventory_metric_snapshot
        UNIQUE (
            customer_id,
            sku,
            period_start,
            metric_name,
            value_type,
            as_of_date,
            data_source
        )
);

CREATE TABLE IF NOT EXISTS customer_doh_targets (
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
    effective_from DATE NOT NULL,
    effective_to DATE,
    target_doh DOUBLE PRECISION NOT NULL,
    source VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id, effective_from),
    CONSTRAINT ck_customer_doh_targets_dates
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT ck_customer_doh_targets_positive
        CHECK (target_doh > 0)
);

-- Fail instead of silently creating an incomplete FairPrice bridge.
DO $$
DECLARE
    fairprice_retailer_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO fairprice_retailer_count
    FROM retailers
    WHERE (retailer_id = 55 AND retailer_name = 'fairprice_online')
       OR (retailer_id = 57 AND retailer_name = 'fairprice_offline');

    IF fairprice_retailer_count <> 2 THEN
        RAISE EXCEPTION
            'Expected retailer 55 fairprice_online and retailer 57 fairprice_offline; found %',
            fairprice_retailer_count;
    END IF;
END;
$$;

INSERT INTO customers (customer_name)
VALUES ('fairprice')
ON CONFLICT (customer_name) DO NOTHING;

INSERT INTO customer_retailers (customer_id, retailer_id)
SELECT customer.customer_id, retailer.retailer_id
FROM customers AS customer
CROSS JOIN retailers AS retailer
WHERE customer.customer_name = 'fairprice'
  AND (
      (retailer.retailer_id = 55 AND retailer.retailer_name = 'fairprice_online')
      OR
      (retailer.retailer_id = 57 AND retailer.retailer_name = 'fairprice_offline')
  )
ON CONFLICT DO NOTHING;

INSERT INTO customer_doh_targets (
    customer_id,
    effective_from,
    effective_to,
    target_doh,
    source
)
SELECT
    customer_id,
    DATE '2026-01-01',
    NULL,
    30,
    'client-provided initial target'
FROM customers
WHERE customer_name = 'fairprice'
ON CONFLICT (customer_id, effective_from) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_inventory_metrics_period
    ON inventory_metrics (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_inventory_metrics_customer_sku
    ON inventory_metrics (customer_id, sku);

CREATE INDEX IF NOT EXISTS idx_inventory_metrics_current_lookup
    ON inventory_metrics (
        customer_id,
        sku,
        period_start,
        metric_name,
        as_of_date DESC
    );

CREATE INDEX IF NOT EXISTS idx_inventory_metrics_source_file
    ON inventory_metrics (source_file);

CREATE INDEX IF NOT EXISTS idx_customer_doh_targets_effective
    ON customer_doh_targets (customer_id, effective_from, effective_to);

COMMIT;
