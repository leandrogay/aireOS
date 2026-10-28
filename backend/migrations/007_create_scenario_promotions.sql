-- To run this migration in Cloud SQL, in the `aireos` database on instance aireos-postgresql, after 006
-- (instructions: docs/promo-uplift-runbook.md).

-- Scenario builder promotions: planned promotions (a mechanic such as
-- "30% Off", an optional voucher and an optional override of the uplift)
-- that only move the Scenario builder's Simulated line. The Current
-- forecast, Inventory, Dashboard and the real `promotions` table never read
-- or change this table. Same shape and rules as scenario_building_blocks
-- (004_create_scenario_building_blocks.sql): saved straight away, switched on or off with is_active, and a
-- delete is a real DELETE.
--
-- The uplift values are copied in when the promotion is saved
-- (reference_uplift_pct, voucher_uplift_pct), so a later change in Promotion Uplift
-- Settings (006) -- an edited value, a moved anchor, or measured values
-- replacing rule-based uplifts -- never silently moves a promotion already saved.
-- Like building blocks, the uplift is stored as a %, never as a delta: the
-- frontend works out the units from the Current forecast each time.
--
-- Needs 006_create_promo_uplift_settings.sql only for the mechanic keys it
-- names; there is no foreign key to it, because settings rows are
-- versioned (append-only) and a key is not unique there.
BEGIN;

CREATE TABLE IF NOT EXISTS scenario_promotions (
    promotion_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    -- One SKU per promotion: promotions are planned per SKU.
    sku VARCHAR(100) NOT NULL REFERENCES skus(sku),
    -- Same values as PROMO_OVERLAY_TYPES on the frontend.
    promo_type VARCHAR(20) NOT NULL
        CHECK (promo_type IN ('monthly', 'side_offer', 'bundle', 'others')),
    mechanic_key VARCHAR(40) NOT NULL CHECK (btrim(mechanic_key) <> ''),
    mechanic_label VARCHAR(120) NOT NULL,
    -- The mechanic's uplift from Promotion Uplift Settings when saved, and
    -- where it came from (rule_based / measured / estimate / learned).
    reference_uplift_pct NUMERIC(6,2) NOT NULL CHECK (reference_uplift_pct BETWEEN -90 AND 300),
    reference_source VARCHAR(20) NOT NULL
        CHECK (reference_source IN ('rule_based', 'measured', 'estimate', 'learned')),
    -- NULL = no override; otherwise replaces the mechanic's uplift.
    override_uplift_pct NUMERIC(6,2) CHECK (override_uplift_pct BETWEEN -90 AND 300),
    voucher BOOLEAN NOT NULL DEFAULT FALSE,
    voucher_uplift_pct NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (voucher_uplift_pct BETWEEN -90 AND 300),
    explanation TEXT,
    start_month DATE NOT NULL CHECK (start_month = date_trunc('month', start_month)),
    end_month DATE NOT NULL CHECK (end_month = date_trunc('month', end_month)),
    -- Side offers only (they run weekly): the exact days the promotion
    -- runs, inside start_month..end_month. NULL = whole months. Each month
    -- adds the share of its days the dates cover (day-weighted, like the
    -- anchor in 006).
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_scenario_promotions_months CHECK (end_month >= start_month),
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

COMMIT;
