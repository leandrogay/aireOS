-- Apply by hand after 028. Existing entries remain Current-mode scenarios.
BEGIN;
ALTER TABLE scenario_building_blocks ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'scenario'
    CHECK (plan IN ('scenario', 'budget'));
ALTER TABLE scenario_promotions ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'scenario'
    CHECK (plan IN ('scenario', 'budget'));
DROP INDEX IF EXISTS uq_scenario_building_blocks_growth_year;
CREATE UNIQUE INDEX IF NOT EXISTS uq_scenario_building_blocks_growth_plan_year
    ON scenario_building_blocks (plan, customer_id, start_month) WHERE kind = 'growth';

-- A version is one complete year's lock. Rows never change when inputs change.
CREATE TABLE IF NOT EXISTS budget_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    version INTEGER NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_by TEXT NOT NULL,
    inputs JSONB NOT NULL,
    UNIQUE (year, version)
);
CREATE TABLE IF NOT EXISTS budget_snapshot_rows (
    snapshot_id BIGINT NOT NULL REFERENCES budget_snapshots ON DELETE CASCADE,
    customer_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    sku_range TEXT,
    month_year DATE NOT NULL CHECK (EXTRACT(DAY FROM month_year) = 1),
    units DOUBLE PRECISION NOT NULL CHECK (units >= 0 AND units < 'Infinity'::float8),
    PRIMARY KEY (snapshot_id, customer_id, sku, month_year)
);
-- Names and ids are frozen too; catalog deletion never deletes budget history.
CREATE INDEX IF NOT EXISTS budget_snapshot_rows_customer ON budget_snapshot_rows (customer_id, month_year);
COMMIT;
