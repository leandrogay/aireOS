-- To run this migration in Cloud SQL, after 022_promo_anchor_effective_from.sql.

-- Worked-out promotion moments and uplifts, so Promotion Uplift Settings and
-- the Scenario builder read them with plain SELECTs instead of reading every
-- customer's sell-out on each page load. Worked out per customer when its
-- inputs change (promotions, sell-out, anchors, mechanic discounts), never on
-- a page load (services/settings/promo_recalc.py).
--
--   promo_recalc_requests  the queue. A save records a row in its own
--                          transaction (customer_id NULL = every customer);
--                          the worker claims every pending row at once and
--                          recalculates each customer once, so a batch of
--                          uploads is one recalculation per customer.
--   promo_moment_calc      one row per customer x SKU x month that is a
--                          moment: real (with units, measured against the
--                          anchor version of its month) or planned (an
--                          official promotion with no sales yet; it only
--                          counts towards anchors).
--   promo_uplift_calc      the uplift per customer x SKU x mechanic x anchor
--                          version, with how it was worked out
--                          (promo_anchor_versions.choose_uplift). A mechanic
--                          with no moments has no row: its value is the
--                          placeholder rule, worked out on read.
--   promo_calc_status      when each customer was last worked out, and the
--                          last error and warnings, if any.
--
-- The three calc tables are derived: deleting their rows and rebuilding
-- (scripts/rebuild_promo_calc.py) loses nothing. Safe to rerun.
BEGIN;

CREATE TABLE IF NOT EXISTS promo_recalc_requests (
    request_id BIGSERIAL PRIMARY KEY,
    -- NULL = every customer (an all-customers anchor or a mechanic changed).
    customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
    reason VARCHAR(30) NOT NULL CHECK (
        reason IN ('promotion_change', 'sales_upload', 'sales_rollback', 'anchor_change',
                   'mechanic_change', 'manual', 'retry')
    ),
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_promo_recalc_requests_pending
    ON promo_recalc_requests (customer_id)
    WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS promo_moment_calc (
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    month DATE NOT NULL CHECK (month = date_trunc('month', month)),
    promotion_id BIGINT NOT NULL,
    mechanic_key VARCHAR(40) NOT NULL,
    mechanic_label VARCHAR(255),
    planned BOOLEAN NOT NULL,
    -- The rest is NULL on a planned moment.
    units NUMERIC(14,2),
    -- The anchor version the moment is measured against (promo_anchor_settings
    -- row); NULL = none saved, so the group's most common mechanic.
    anchor_id BIGINT,
    version_from DATE,
    baseline_mechanic_key VARCHAR(40),
    baseline_units NUMERIC(14,2),
    -- version: the version's own anchor months; all_time: every month at the
    -- mechanic (too few in the version); NULL: no baseline.
    baseline_source VARCHAR(20) CHECK (baseline_source IN ('version', 'all_time')),
    baseline_months DATE[] NOT NULL DEFAULT '{}',
    is_baseline BOOLEAN,
    uplift_pct NUMERIC(8,2),
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id, sku, month),
    CONSTRAINT ck_promo_moment_calc_planned CHECK (planned = (units IS NULL))
);

CREATE TABLE IF NOT EXISTS promo_uplift_calc (
    uplift_calc_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    mechanic_key VARCHAR(40) NOT NULL,
    anchor_id BIGINT,
    version_from DATE,
    level VARCHAR(20) NOT NULL CHECK (
        level IN ('anchor', 'measured', 'measured_earlier', 'placeholder', 'unavailable')
    ),
    uplift_pct NUMERIC(8,2),
    explanation JSONB NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One value per customer x SKU x mechanic x version (NULL version = none saved).
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_uplift_calc_target
    ON promo_uplift_calc (customer_id, sku, mechanic_key, COALESCE(anchor_id, 0));

CREATE TABLE IF NOT EXISTS promo_calc_status (
    customer_id INTEGER PRIMARY KEY REFERENCES customers(customer_id) ON DELETE CASCADE,
    calculated_at TIMESTAMPTZ,
    -- Problems that did not stop the calculation, e.g. a projected anchor
    -- left unsaved because its mechanic has no discount.
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_error TEXT,
    last_error_at TIMESTAMPTZ
);

-- Same service accounts as 015_create_sell_in_plan_snapshots.sql. The calc
-- tables are replaced per customer (DELETE then INSERT) on each run.
GRANT SELECT, INSERT, UPDATE ON promo_recalc_requests
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE promo_recalc_requests_request_id_seq
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT SELECT, INSERT, UPDATE, DELETE ON promo_moment_calc, promo_uplift_calc, promo_calc_status
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE promo_uplift_calc_uplift_calc_id_seq
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";

COMMIT;
