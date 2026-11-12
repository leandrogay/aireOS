-- To run this migration in Cloud SQL, after 023_scenario_items_excluded_pairs.sql.

-- The budget's growth is set per customer, not per SKU range: a growth
-- (kind = 'growth') is a % on every SKU of one customer from January to
-- December, at most one per customer x year. It replaces the per-range rule
-- of 017.
--
-- Growth already saved per range is merged: where all of a customer's
-- ranges for a year have the same %, they become one growth on every SKU.
-- Where they differ, nothing is changed and the migration stops, listing
-- them, rather than guess which % to keep: set one value for them (or delete
-- the extra rows) and run it again. Safe to rerun.
BEGIN;

DO $$
DECLARE
    clashes TEXT;
BEGIN
    SELECT string_agg(
               format('customer %s, %s: %s', customer_id, EXTRACT(YEAR FROM start_month), values_found),
               '; '
           )
    INTO clashes
    FROM (
        SELECT customer_id, start_month, string_agg(DISTINCT uplift_value::TEXT || '%', ', ') AS values_found
        FROM scenario_building_blocks
        WHERE kind = 'growth'
        GROUP BY customer_id, start_month
        HAVING COUNT(DISTINCT uplift_value) > 1
    ) AS differing;

    IF clashes IS NOT NULL THEN
        RAISE EXCEPTION 'Growth differs by SKU range for: %. Set one value per customer and year first.', clashes;
    END IF;
END
$$;

ALTER TABLE scenario_building_blocks
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_growth;
DROP INDEX IF EXISTS uq_scenario_building_blocks_growth_range_year;

-- One growth per customer x year: keep the oldest row of each, on every SKU.
DELETE FROM scenario_building_blocks AS extra
USING scenario_building_blocks AS kept
WHERE extra.kind = 'growth'
    AND kept.kind = 'growth'
    AND extra.customer_id = kept.customer_id
    AND extra.start_month = kept.start_month
    AND extra.block_id > kept.block_id;

UPDATE scenario_building_blocks
SET sku_ranges = NULL,
    sku = NULL,
    name = 'Growth ' || EXTRACT(YEAR FROM start_month)::TEXT,
    updated_at = CURRENT_TIMESTAMP
WHERE kind = 'growth'
    AND (sku_ranges IS NOT NULL OR sku IS NOT NULL);

ALTER TABLE scenario_building_blocks
    ADD CONSTRAINT ck_scenario_building_blocks_growth CHECK (
        kind <> 'growth'
        OR (
            uplift_mode = 'pct'
            AND sku IS NULL
            AND sku_ranges IS NULL
            AND EXTRACT(MONTH FROM start_month) = 1
            AND end_month = (start_month + INTERVAL '11 months')::date
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_scenario_building_blocks_growth_year
    ON scenario_building_blocks (customer_id, start_month)
    WHERE kind = 'growth';

COMMIT;
