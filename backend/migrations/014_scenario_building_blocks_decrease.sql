-- To run this migration in Cloud SQL, after 004_create_scenario_building_blocks.sql.

-- A building block can now lower sales as well as raise them: a flood, a
-- store closing for renovation, a competitor's launch. The uplift stays one
-- signed value, as entered:
--   pct:   % of the Current forecast in each month, from -100 (no sales at
--          all) to +50; never 0.
--   units: whole units added (or, negative, removed) across the whole month
--          range; never 0.
-- The Simulated line never goes below 0 in a month, however many decreases
-- stack up (frontend scenarioEngine.simulate).
BEGIN;

ALTER TABLE scenario_building_blocks
    DROP CONSTRAINT IF EXISTS scenario_building_blocks_uplift_value_check,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_pct,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_nonzero;

ALTER TABLE scenario_building_blocks
    ADD CONSTRAINT ck_scenario_building_blocks_nonzero CHECK (uplift_value <> 0),
    ADD CONSTRAINT ck_scenario_building_blocks_pct
        CHECK (uplift_mode <> 'pct' OR uplift_value BETWEEN -100 AND 50);

COMMIT;
