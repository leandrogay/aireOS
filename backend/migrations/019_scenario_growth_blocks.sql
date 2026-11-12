-- To run this migration in Cloud SQL, after 018_add_customer_color.sql.

-- Growth for the budget: next year = this year x (1 + g). Tier 0 has no growth
-- factor any more (bigquery/views/010_create_tier0_legacy_forecasts_view.sql,
-- 8 Nov 2026), so a planner sets g in the Scenario builder instead. A growth of
-- g% over a year is exactly a % building block on every SKU from January to
-- December, so it is stored as one, marked kind = 'growth' so the page can show
-- it as its own field and there is at most one per customer per year. It is
-- worked out like any % block: g% of Tier 0 in each month, added to the other
-- blocks and promotions, never multiplied with them (frontend scenarioEngine.js,
-- backend scenario/block_effects.py).
--
--   kind = 'block':  every block saved so far (the default).
--   kind = 'growth': uplift_mode 'pct', every SKU (sku NULL), start_month a
--                    January and end_month the December of the same year; the
--                    usual % limits (-100 to +50, never 0) still apply.
--
-- Switching a growth block inactive keeps it without counting, like any block,
-- and it still holds that customer's year.
BEGIN;

ALTER TABLE scenario_building_blocks
    ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'block';

ALTER TABLE scenario_building_blocks
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_kind,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_growth;

ALTER TABLE scenario_building_blocks
    ADD CONSTRAINT ck_scenario_building_blocks_kind CHECK (kind IN ('block', 'growth')),
    ADD CONSTRAINT ck_scenario_building_blocks_growth CHECK (
        kind <> 'growth'
        OR (
            uplift_mode = 'pct'
            AND sku IS NULL
            AND EXTRACT(MONTH FROM start_month) = 1
            AND end_month = (start_month + INTERVAL '11 months')::date
        )
    );

-- One growth block per customer per year (start_month is that year's January).
CREATE UNIQUE INDEX IF NOT EXISTS uq_scenario_building_blocks_growth_year
    ON scenario_building_blocks (customer_id, start_month)
    WHERE kind = 'growth';

COMMIT;
