-- To run this migration in Cloud SQL, after 020_scenario_blocks_by_sku_range.sql.

-- Scenario builder promotions: planned promotions (a mechanic such as
-- "30% Off", an optional voucher and an optional override of the uplift)
-- that only move the Scenario builder's Simulated line. The Current
-- forecast, Inventory, Dashboard, the real `promotions` table and the
-- promo anchors (promo_anchor_settings, 012/013) never read or change this
-- table: an anchor moves only once real sales show the new discount.
-- Same shape and rules as scenario_building_blocks (004, 014, 020): saved
-- straight away, switched on or off with is_active, and a delete is a real
-- DELETE. Deleting a customer deletes its promotions.
--
-- The uplift values are copied in when the promotion is saved
-- (reference_uplift_pct, reference_by_sku, voucher_*), so a later change in
-- Promotion Uplift Settings -- an edited value, a moved anchor, measured
-- values replacing placeholders -- never silently moves a saved promotion.
-- Like building blocks, the uplift is stored as a %, never as a delta: the
-- frontend works out the units from the forecast each time
-- (app/utils/scenarioPromotions.js).
--
-- SKU scope follows building blocks (020):
--   sku_ranges set:           every SKU of those ranges (never an empty list).
--   sku and sku_ranges NULL:  every SKU of the customer ("All SKU ranges").
--   sku set:                  one SKU -- promotions planned before ranges
--                             only; the page no longer offers it. Never both.
--
-- No foreign key to promo_uplift_settings for mechanic_key: settings rows
-- are append-only versions, so a key is not unique there. reference_source
-- is the tag the page copied (placeholder, measured, manual, …), so it is
-- not a closed list here either.
--
-- The CHECKs mirror app/schemas/scenario/promotions.py, which stays the
-- first line of validation. Safe to rerun.
BEGIN;

CREATE TABLE IF NOT EXISTS scenario_promotions (
    promotion_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    sku_ranges TEXT[],
    -- SKUs are archived, not deleted, so a plain foreign key is enough.
    sku VARCHAR(100) REFERENCES skus(sku),
    -- Same values as PROMO_OVERLAY_TYPES on the frontend.
    promo_type VARCHAR(20) NOT NULL
        CHECK (promo_type IN ('monthly', 'side_offer', 'bundle', 'others')),
    mechanic_key VARCHAR(40) NOT NULL CHECK (btrim(mechanic_key) <> ''),
    mechanic_label VARCHAR(120) NOT NULL CHECK (btrim(mechanic_label) <> ''),
    -- The mechanic's uplift from Promotion Uplift Settings when saved, and
    -- per SKU where the SKUs in scope have their own (JSON object of
    -- sku -> %).
    reference_uplift_pct NUMERIC(6,2) NOT NULL CHECK (reference_uplift_pct BETWEEN -90 AND 300),
    reference_source VARCHAR(20) NOT NULL CHECK (btrim(reference_source) <> ''),
    reference_by_sku JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reference_by_sku) = 'object'),
    -- NULL = no override; otherwise replaces the mechanic's uplift.
    override_uplift_pct NUMERIC(6,2) CHECK (override_uplift_pct BETWEEN -90 AND 300),
    voucher BOOLEAN NOT NULL DEFAULT FALSE,
    voucher_uplift_pct NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (voucher_uplift_pct BETWEEN -90 AND 300),
    voucher_by_sku JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(voucher_by_sku) = 'object'),
    explanation TEXT,
    start_month DATE NOT NULL CHECK (start_month = date_trunc('month', start_month)),
    end_month DATE NOT NULL CHECK (end_month = date_trunc('month', end_month)),
    -- Side offers only (they run weekly): the exact days the promotion
    -- runs, inside start_month..end_month. NULL = whole months.
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_scenario_promotions_months CHECK (end_month >= start_month),
    CONSTRAINT ck_scenario_promotions_ranges_not_empty
        CHECK (sku_ranges IS NULL OR cardinality(sku_ranges) > 0),
    CONSTRAINT ck_scenario_promotions_one_scope CHECK (sku IS NULL OR sku_ranges IS NULL),
    CONSTRAINT ck_scenario_promotions_dates CHECK (
        (start_date IS NULL AND end_date IS NULL)
        OR (
            promo_type = 'side_offer'
            AND end_date >= start_date
            AND date_trunc('month', start_date) = start_month
            AND date_trunc('month', end_date) = end_month
        )
    )
);

-- The page loads every promotion newest first (list_scenario_promotions).
CREATE INDEX IF NOT EXISTS ix_scenario_promotions_created
    ON scenario_promotions (created_at DESC, promotion_id DESC);

-- Same service accounts as 015_create_sell_in_plan_snapshots.sql. A delete
-- is a real DELETE, like building blocks.
GRANT SELECT, INSERT, UPDATE, DELETE ON scenario_promotions
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE scenario_promotions_promotion_id_seq
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";

COMMIT;
