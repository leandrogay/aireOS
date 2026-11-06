-- To run this migration in Cloud SQL.

-- Promotion uplift settings (Forecast > Promotion uplift settings), read and
-- written by app/services/settings/promo_uplifts.py:
--   promo_anchor_settings: the ordinary-month discount ("anchor") placeholder
--     uplifts are measured from, per customer x SKU range, per customer, and
--     for all customers.
--   promo_uplift_settings: the uplift of each promotion mechanic, for all
--     customers or one customer, SKU range or SKU.
-- Recommended Uplift, moments and the anchor suggested from promotions are
-- worked out live from promotions + sellout and are never stored here.
--
-- Both tables are append-only, like doh_settings: a change inserts a new row
-- and the newest row (updated_at DESC, then id DESC) for the same target is
-- its current value. Nothing is ever updated or deleted, so the history is
-- the table itself. Deleting a customer deletes its rows, so settings never
-- block it. SKUs are archived, not deleted, so a plain foreign key is enough.
--
-- Replaces the draft 006_create_promo_uplift_settings.sql on
-- feat/AO5-18&19-promotion-uplift-settings (main now has its own 006/007).
BEGIN;

CREATE TABLE IF NOT EXISTS promo_anchor_settings (
    anchor_id BIGSERIAL PRIMARY KEY,
    -- customer_id NULL = all customers (with no row the code uses 20%);
    -- sku_range NULL = the whole customer. Order: range, customer, all.
    customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
    sku_range VARCHAR(255),
    -- NULL with source 'suggested': use the value suggested from the data.
    anchor_pct NUMERIC(5,2) CHECK (anchor_pct >= 0 AND anchor_pct <= 100),
    source VARCHAR(20) NOT NULL,
    updated_by VARCHAR(255) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_promo_anchor_settings_source
        CHECK (source IN ('manual', 'suggested')),
    CONSTRAINT ck_promo_anchor_settings_manual_pct
        CHECK (source <> 'manual' OR anchor_pct IS NOT NULL),
    CONSTRAINT ck_promo_anchor_settings_range_needs_customer
        CHECK (sku_range IS NULL OR customer_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_promo_anchor_settings_target
    ON promo_anchor_settings (customer_id, sku_range, updated_at DESC, anchor_id DESC);

CREATE TABLE IF NOT EXISTS promo_uplift_settings (
    uplift_id BIGSERIAL PRIMARY KEY,
    -- The target: customer_id NULL = all customers; then sku (one SKU),
    -- else sku_range (one range), else the whole customer.
    customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
    sku_range VARCHAR(255),
    sku VARCHAR(100) REFERENCES skus(sku),
    -- One standard label per mechanic ("25% Off", "Buy 2 Get 1 Free"). The
    -- labels typed on promotions ("25%", "25 % OFF") are matched to it in code
    -- (promo_uplift_rules.mechanic_key).
    promotion_mechanic VARCHAR(120) NOT NULL,
    -- NULL when the mechanic has no percentage discount (Voucher).
    effective_discount_pct NUMERIC(5,2),
    -- NULL only on a 'removed' row.
    uplift_pct NUMERIC(6,2),
    -- placeholder: the anchor rule; estimate: a Manual Uplift someone set;
    -- learned: set by the forecasting model; removed: a customer, range or
    -- SKU value taken away, so the broader value applies again.
    source VARCHAR(20) NOT NULL,
    note TEXT,
    updated_by VARCHAR(255) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_promo_uplift_settings_source
        CHECK (source IN ('placeholder', 'estimate', 'learned', 'removed')),
    CONSTRAINT ck_promo_uplift_settings_uplift
        CHECK ((source = 'removed') = (uplift_pct IS NULL)),
    CONSTRAINT ck_promo_uplift_settings_target CHECK (
        (customer_id IS NULL AND sku_range IS NULL AND sku IS NULL)
        OR (customer_id IS NOT NULL AND NOT (sku_range IS NOT NULL AND sku IS NOT NULL))
    ),
    CONSTRAINT ck_promo_uplift_settings_all_customers_kept
        CHECK (customer_id IS NOT NULL OR source <> 'removed')
);

CREATE INDEX IF NOT EXISTS idx_promo_uplift_settings_target
    ON promo_uplift_settings (promotion_mechanic, customer_id, sku_range, sku, updated_at DESC, uplift_id DESC);

-- The all-customers placeholder for every mechanic in use, at the 20%
-- fallback anchor: (discount - 20) / 5 x 2, to a whole percent
-- (promo_uplift_rules.placeholder_uplift). The service recalculates them
-- from each customer's and range's own anchor.
INSERT INTO promo_uplift_settings
    (promotion_mechanic, effective_discount_pct, uplift_pct, source, updated_by)
SELECT seed.promotion_mechanic, seed.effective_discount_pct, seed.uplift_pct, 'placeholder', 'seed'
FROM (
    VALUES
        ('5% Off', 5, -6),
        ('10% Off', 10, -4),
        ('15% Off', 15, -2),
        ('20% Off', 20, 0),
        ('25% Off', 25, 2),
        ('Buy 2 Get 25% Off', 25, 2),
        ('27% Off', 27, 3),
        ('30% Off', 30, 4),
        ('Buy 2 Get 30% Off', 30, 4),
        ('Buy 2 Get 1 Free', 33.3, 5),
        ('50% Off', 50, 12),
        ('Buy 1 Get 1 Free', 50, 12),
        ('Voucher', NULL, 3)
) AS seed (promotion_mechanic, effective_discount_pct, uplift_pct)
-- Re-running the migration must not add a second set.
WHERE NOT EXISTS (
    SELECT 1
    FROM promo_uplift_settings existing
    WHERE existing.promotion_mechanic = seed.promotion_mechanic
        AND existing.customer_id IS NULL
);

COMMIT;
