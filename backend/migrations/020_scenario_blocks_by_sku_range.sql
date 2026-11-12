-- To run this migration in Cloud SQL, after 019_scenario_growth_blocks.sql.

-- Scenario builder building blocks and growth follow SKU ranges
-- (skus.sku_range, e.g. every Ultra Pants size), not one SKU at a time, and a
-- block can cover several ranges at once.
--
--   sku_ranges set:           every SKU of those ranges (never an empty list).
--   sku and sku_ranges NULL:  every SKU of the customer ("All SKU ranges").
--   sku set:                  one SKU -- blocks saved before this migration
--                             only; the page no longer offers it. Never both.
--
-- A growth is per customer x SKU range x year (next year = Tier 0 x (1 + g)
-- for that range), so it names exactly one range, and the one-per-year rule
-- is customer x range x year.
--
-- Safe to run whether or not an earlier draft of this file (a single
-- sku_range column) already ran: that column is copied into sku_ranges and
-- dropped. Safe to rerun.
BEGIN;

-- A growth saved under 019 covers every SKU, which this migration no longer
-- allows. Stop rather than guess which range it was meant for: delete or
-- re-enter those rows first (there should be none -- the growth control was
-- never released before this change). Checked only before any range column
-- exists, so a rerun is safe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'scenario_building_blocks' AND column_name IN ('sku_range', 'sku_ranges')
    ) AND EXISTS (SELECT 1 FROM scenario_building_blocks WHERE kind = 'growth') THEN
        RAISE EXCEPTION 'scenario_building_blocks has growth rows without a SKU range; remove them before running 020';
    END IF;
END
$$;

ALTER TABLE scenario_building_blocks
    ADD COLUMN IF NOT EXISTS sku_ranges TEXT[];

-- The earlier draft's single column, if it ran: carry its values over, then
-- drop it with the constraints and index built on it.
ALTER TABLE scenario_building_blocks
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_one_scope,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_growth,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_ranges_not_empty;
DROP INDEX IF EXISTS uq_scenario_building_blocks_growth_year;
DROP INDEX IF EXISTS uq_scenario_building_blocks_growth_range_year;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'scenario_building_blocks' AND column_name = 'sku_range'
    ) THEN
        UPDATE scenario_building_blocks
        SET sku_ranges = ARRAY[sku_range]
        WHERE sku_range IS NOT NULL AND sku_ranges IS NULL;

        ALTER TABLE scenario_building_blocks DROP COLUMN sku_range;
    END IF;
END
$$;

ALTER TABLE scenario_building_blocks
    ADD CONSTRAINT ck_scenario_building_blocks_ranges_not_empty
        CHECK (sku_ranges IS NULL OR cardinality(sku_ranges) > 0),
    ADD CONSTRAINT ck_scenario_building_blocks_one_scope CHECK (sku IS NULL OR sku_ranges IS NULL),
    ADD CONSTRAINT ck_scenario_building_blocks_growth CHECK (
        kind <> 'growth'
        OR (
            uplift_mode = 'pct'
            AND sku IS NULL
            -- IS NOT NULL first: cardinality(NULL) is NULL, which a CHECK lets through.
            AND sku_ranges IS NOT NULL
            AND cardinality(sku_ranges) = 1
            AND EXTRACT(MONTH FROM start_month) = 1
            AND end_month = (start_month + INTERVAL '11 months')::date
        )
    );

-- One growth per customer x SKU range x year (start_month is that year's January).
CREATE UNIQUE INDEX IF NOT EXISTS uq_scenario_building_blocks_growth_range_year
    ON scenario_building_blocks (customer_id, (sku_ranges[1]), start_month)
    WHERE kind = 'growth';

COMMIT;
