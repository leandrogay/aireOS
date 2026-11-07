-- To run this migration in Cloud SQL.

-- Scenario builder building blocks: what-if uplifts (a new store opening, a
-- gift with purchase…) that only move the Scenario builder's Simulated line.
-- The Current forecast, Inventory and Dashboard never read this table.
-- Confirmed blocks that turn into actuals live in inventory_metrics'
-- sell_out_building_blocks instead; the two may merge in a later refactor.
-- Draft promotions in the Scenario builder get a table of their own.
--
-- The uplift is stored as entered (a % or a number of units), never as a
-- delta, so it stays right when the forecast underneath is refreshed: the
-- frontend works out the delta from the Current forecast each time.
--
-- Switching a block inactive is how it is kept without counting, so a
-- delete is a real DELETE. Deleting a customer deletes its blocks, so they
-- never stop a customer from being deleted. SKUs are archived, not deleted,
-- so a plain foreign key is enough there.
BEGIN;

CREATE TABLE IF NOT EXISTS scenario_building_blocks (
    block_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    -- NULL = every SKU of the customer.
    sku VARCHAR(100) REFERENCES skus(sku),
    name VARCHAR(120) NOT NULL CHECK (btrim(name) <> ''),
    explanation TEXT,
    -- pct: % added to the Current forecast in each month, (0, 50].
    -- units: whole units added across the whole month range.
    uplift_mode VARCHAR(10) NOT NULL CHECK (uplift_mode IN ('pct', 'units')),
    uplift_value NUMERIC(12,2) NOT NULL CHECK (uplift_value > 0),
    start_month DATE NOT NULL CHECK (start_month = date_trunc('month', start_month)),
    end_month DATE NOT NULL CHECK (end_month = date_trunc('month', end_month)),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_scenario_building_blocks_months CHECK (end_month >= start_month),
    CONSTRAINT ck_scenario_building_blocks_pct CHECK (uplift_mode <> 'pct' OR uplift_value <= 50),
    CONSTRAINT ck_scenario_building_blocks_units CHECK (uplift_mode <> 'units' OR uplift_value = trunc(uplift_value))
);

COMMIT;
