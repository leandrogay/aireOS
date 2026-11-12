-- To run this migration in Cloud SQL, after 025_scenario_items_several_customers.sql.

-- A Scenario builder building block or promotion stays one entry for
-- several customers x SKU ranges, but each customer x range can be switched
-- off on its own (the row opens to list them). The ones switched off are
-- kept here:
--
--   excluded_pairs = [{"customer_id": 1, "sku_range": "Ultra Tape"}, ...]
--
-- sku_range null = the customer's SKUs with no range. A customer or range
-- added later is in by default. Ids, not names, so renaming a customer keeps
-- its pairs; deleting one drops them (customer_service.delete_customer). A
-- growth never excludes anything.
--
-- Additive and safe to rerun.
BEGIN;

ALTER TABLE scenario_building_blocks
    ADD COLUMN IF NOT EXISTS excluded_pairs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE scenario_promotions
    ADD COLUMN IF NOT EXISTS excluded_pairs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE scenario_building_blocks
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_excluded_pairs_list,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_growth_excludes_nothing;

ALTER TABLE scenario_building_blocks
    ADD CONSTRAINT ck_scenario_building_blocks_excluded_pairs_list
        CHECK (jsonb_typeof(excluded_pairs) = 'array'),
    ADD CONSTRAINT ck_scenario_building_blocks_growth_excludes_nothing
        CHECK (kind <> 'growth' OR excluded_pairs = '[]'::jsonb);

ALTER TABLE scenario_promotions
    DROP CONSTRAINT IF EXISTS ck_scenario_promotions_excluded_pairs_list;

ALTER TABLE scenario_promotions
    ADD CONSTRAINT ck_scenario_promotions_excluded_pairs_list
        CHECK (jsonb_typeof(excluded_pairs) = 'array');

COMMIT;
