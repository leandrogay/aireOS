-- Review this migration before executing it against Cloud SQL.
BEGIN;

CREATE TABLE IF NOT EXISTS sellout (
    retailer_id INTEGER NOT NULL REFERENCES retailers(retailer_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type VARCHAR(20) NOT NULL,
    store_code VARCHAR(100) NOT NULL,
    sku VARCHAR(100) NOT NULL REFERENCES skus(sku),
    quantity_units DOUBLE PRECISION,
    revenue DOUBLE PRECISION,
    source_file VARCHAR(255),
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_source VARCHAR(100) NOT NULL DEFAULT 'aireos_upload',
    PRIMARY KEY (retailer_id, store_code, sku, period_start, period_type),
    CONSTRAINT fk_sellout_store
        FOREIGN KEY (retailer_id, store_code)
        REFERENCES stores(retailer_id, store_code)
);

CREATE INDEX IF NOT EXISTS idx_sellout_period
    ON sellout (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_sellout_sku
    ON sellout (sku);

CREATE INDEX IF NOT EXISTS idx_sellout_source_file
    ON sellout (source_file);

COMMIT;
