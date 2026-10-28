-- To run this migration in Cloud SQL, in the `aireos` database on instance aireos-postgresql, after 006
-- (instructions: docs/promo-uplift-runbook.md).
--
-- Tables for the promotion uplift measurement job
-- (backend/app/services/settings/promo_measurement.py): the job measures each
-- mechanic's uplift from sales data and writes 'measured' rows into
-- promo_uplift_settings (006). These tables hold its settings, a record of
-- every run, the evidence behind every measured uplift, and the notes shown
-- where a measured uplift differs from one a person typed in.
--
-- All four are append-only, like 006: a change supersedes the current row
-- and inserts a new one; nothing is updated in place except superseded_at,
-- and nothing is deleted.
BEGIN;

-- The job's settings, versioned. One current row.
CREATE TABLE IF NOT EXISTS promo_measurement_config (
    id BIGSERIAL PRIMARY KEY,
    -- Starting weight (k): the uplift a value leans on (the rule-based uplift
    -- for a customer, the blended customer uplift for a SKU) counts as this
    -- many months of evidence.
    starting_weight NUMERIC(5,2) NOT NULL CHECK (starting_weight > 0),
    -- A mechanic counts as evidence for a SKU-month only from this exposure
    -- (share of the month, at the customer's usual reach). 0.23 = 7 of 30 days.
    min_exposure NUMERIC(4,3) NOT NULL CHECK (min_exposure > 0 AND min_exposure <= 1),
    -- A declined note ("Keep mine") is raised again only when the measured
    -- uplift moves this many points from the declined one.
    reask_points NUMERIC(5,2) NOT NULL CHECK (reask_points >= 0),
    -- The settings page warns when there has been no successful run for this long.
    stale_days INTEGER NOT NULL CHECK (stale_days > 0),
    -- Months of history a SKU needs before a trend line is fitted.
    trend_min_months INTEGER NOT NULL CHECK (trend_min_months >= 2),
    -- Backtest differences smaller than this many points count as agreeing.
    backtest_tolerance_points NUMERIC(5,2) NOT NULL CHECK (backtest_tolerance_points >= 0),
    changed_by VARCHAR(255) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_measurement_config_current
    ON promo_measurement_config ((superseded_at IS NULL))
    WHERE superseded_at IS NULL;

INSERT INTO promo_measurement_config
    (starting_weight, min_exposure, reask_points, stale_days, trend_min_months, backtest_tolerance_points, changed_by)
SELECT 3, 0.23, 2, 100, 6, 1, 'seed'
WHERE NOT EXISTS (SELECT 1 FROM promo_measurement_config);

-- One row per run, written once when the run ends (never updated).
CREATE TABLE IF NOT EXISTS promo_measurement_runs (
    run_id BIGSERIAL PRIMARY KEY,
    triggered_by VARCHAR(20) NOT NULL CHECK (triggered_by IN ('scheduler', 'button')),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(30) NOT NULL
        CHECK (status IN ('succeeded', 'succeeded_with_warnings', 'failed', 'skipped_unchanged')),
    window_start DATE,
    window_end DATE,
    -- Hash of every input; the same inputs never produce two successful runs.
    input_fingerprint VARCHAR(64),
    config_snapshot JSONB,
    counts JSONB,
    warnings JSONB,
    error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_measurement_runs_fingerprint
    ON promo_measurement_runs (input_fingerprint)
    WHERE status IN ('succeeded', 'succeeded_with_warnings');

CREATE INDEX IF NOT EXISTS idx_promo_measurement_runs_finished
    ON promo_measurement_runs (finished_at DESC);

-- The evidence behind every measured uplift, per run. sku NULL = the
-- customer's row.
CREATE TABLE IF NOT EXISTS promo_measurement_results (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES promo_measurement_runs(run_id),
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    sku VARCHAR(100) REFERENCES skus(sku),
    mechanic_key VARCHAR(50) NOT NULL,
    method VARCHAR(10) CHECK (method IN ('trend', 'flat')),
    n NUMERIC(8,2),                  -- this SKU's months of evidence (SKU rows)
    big_n NUMERIC(8,2),              -- the customer's months of evidence (customer rows)
    sku_own_pct NUMERIC(8,2),        -- SKU's own uplift (SKU rows)
    customer_own_pct NUMERIC(8,2),   -- customer's own uplift (volume-weighted over its SKUs)
    rule_based_pct NUMERIC(8,2),     -- rule-based uplift: the customer's starting point
    blended_customer_pct NUMERIC(8,2), -- blended customer uplift: the SKU's starting point
    starting_weight NUMERIC(5,2),
    blended_pct NUMERIC(8,2),        -- this row's blended uplift (customer or SKU)
    backtest_pct NUMERIC(8,2),       -- average forecast error in backtest months with it (NULL = no check)
    backtest_months NUMERIC(8,2),
    outcome VARCHAR(20) NOT NULL
        CHECK (outcome IN ('applied', 'unchanged', 'held_backtest', 'no_evidence', 'estimate_pending', 'skipped')),
    reason TEXT,
    -- The settings row this result wrote, kept, or is about.
    setting_id BIGINT REFERENCES promo_uplift_settings(id),
    window_start DATE,
    window_end DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promo_measurement_results_target
    ON promo_measurement_results (customer_id, mechanic_key, sku, run_id DESC);

-- "Measured uplift is now X; your uplift Y" notes on uplifts a person typed
-- (uplift notes) and on typed ordinary-month discounts (anchor notes).
-- A decision is a new version of the note. One current note per target.
CREATE TABLE IF NOT EXISTS promo_uplift_pending_notes (
    id BIGSERIAL PRIMARY KEY,
    note_type VARCHAR(10) NOT NULL CHECK (note_type IN ('uplift', 'anchor')),
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    mechanic_key VARCHAR(50),        -- uplift notes only
    sku VARCHAR(100) REFERENCES skus(sku),
    setting_id BIGINT REFERENCES promo_uplift_settings(id),
    anchor_id BIGINT REFERENCES promo_anchor_settings(id),
    user_value NUMERIC(8,2) NOT NULL,
    measured_value NUMERIC(8,2) NOT NULL,
    evidence_months NUMERIC(8,2),
    result_id BIGINT REFERENCES promo_measurement_results(id),
    status VARCHAR(20) NOT NULL CHECK (status IN ('open', 'used_measured', 'kept_mine', 'closed')),
    declined_value NUMERIC(8,2),     -- the measured value at the time "Keep mine" was chosen
    decided_by VARCHAR(255),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMPTZ,
    CONSTRAINT chk_promo_note_target CHECK (
        (note_type = 'uplift' AND mechanic_key IS NOT NULL) OR
        (note_type = 'anchor' AND mechanic_key IS NULL AND sku IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_uplift_pending_notes_current
    ON promo_uplift_pending_notes (
        note_type, customer_id, COALESCE(mechanic_key, ''), COALESCE(sku, '')
    )
    WHERE superseded_at IS NULL;

COMMIT;
