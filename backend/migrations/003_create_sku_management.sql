-- Add active-catalog management without breaking historical fact rows that
-- reference skus. "Delete" in the application archives a snapshot and marks
-- the master row inactive; it deliberately does not physically remove it.
BEGIN;

ALTER TABLE skus
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE skus
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS old_skus (
    sku VARCHAR(100) PRIMARY KEY,
    sku_range VARCHAR(255),
    product_name VARCHAR(255),
    size VARCHAR(100),
    brand VARCHAR(255),
    uom VARCHAR(50),
    pack_size INTEGER,
    price NUMERIC(10, 2),
    archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sku_history (
    sku_history_id BIGSERIAL PRIMARY KEY,
    sku VARCHAR(100) NOT NULL,
    action VARCHAR(20) NOT NULL,
    sku_range VARCHAR(255),
    product_name VARCHAR(255),
    size VARCHAR(100),
    brand VARCHAR(255),
    uom VARCHAR(50),
    pack_size INTEGER,
    price NUMERIC(10, 2),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_sku_history_action
        CHECK (action IN ('created', 'updated', 'archived'))
);

-- Establish a baseline version for products that existed before SKU
-- management was introduced. The NOT EXISTS guard keeps this migration safe
-- to review/run again without duplicating history.
INSERT INTO sku_history (
    sku,
    action,
    sku_range,
    product_name,
    size,
    brand,
    uom,
    pack_size,
    price
)
SELECT
    sku,
    'created',
    sku_range,
    product_name,
    size,
    brand,
    uom,
    pack_size,
    price
FROM skus AS product
WHERE NOT EXISTS (
    SELECT 1
    FROM sku_history AS history
    WHERE history.sku = product.sku
);

CREATE INDEX IF NOT EXISTS idx_skus_active_range
    ON skus (is_active, sku_range);

CREATE INDEX IF NOT EXISTS idx_skus_active_brand
    ON skus (is_active, brand);

CREATE INDEX IF NOT EXISTS idx_skus_active_price
    ON skus (is_active, price);

CREATE INDEX IF NOT EXISTS idx_sku_history_sku_changed
    ON sku_history (sku, changed_at DESC, sku_history_id DESC);

COMMIT;
