-- Keep an auditable version of every sell-out row written by an upload so a
-- bad upload can be rolled back without losing the valid row it replaced.
BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_runs (
    ingestion_id BIGSERIAL PRIMARY KEY,
    source_blob TEXT NOT NULL,
    source_file VARCHAR(255) NOT NULL,
    content_hash VARCHAR(64),
    mapping_fingerprint VARCHAR(128),
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    rows_stored INTEGER NOT NULL DEFAULT 0,
    rows_consolidated INTEGER NOT NULL DEFAULT 0,
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rolled_back_at TIMESTAMPTZ,
    rolled_back_by VARCHAR(255),
    rollback_reason TEXT,
    CONSTRAINT ck_ingestion_runs_status
        CHECK (status IN ('processing', 'completed', 'rolled_back'))
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source_blob
    ON ingestion_runs (source_blob, ingestion_id DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status
    ON ingestion_runs (status, loaded_at DESC);

CREATE TABLE IF NOT EXISTS sellout_versions (
    version_id BIGSERIAL PRIMARY KEY,
    ingestion_id BIGINT REFERENCES ingestion_runs(ingestion_id),
    retailer_id INTEGER NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type VARCHAR(20) NOT NULL,
    store_code VARCHAR(100) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    quantity_units DOUBLE PRECISION,
    revenue DOUBLE PRECISION,
    source_file VARCHAR(255),
    loaded_at TIMESTAMPTZ NOT NULL,
    data_source VARCHAR(100) NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One baseline preserves the row that existed before aireOS began recording
-- upload versions. Each later ingestion contributes at most one version of a
-- business key; a tombstone represents a row removed by replacement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sellout_versions_baseline_key
    ON sellout_versions (
        retailer_id, store_code, sku, period_start, period_type
    )
    WHERE ingestion_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sellout_versions_ingestion_key
    ON sellout_versions (
        ingestion_id, retailer_id, store_code, sku, period_start, period_type
    )
    WHERE ingestion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sellout_versions_business_key
    ON sellout_versions (
        retailer_id, store_code, sku, period_start, period_type, version_id DESC
    );

COMMIT;
