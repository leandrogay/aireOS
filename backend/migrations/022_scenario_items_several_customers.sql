-- To run this migration in Cloud SQL, after 021_promo_mechanic_discount_effective_from.sql.

-- Scenario builder building blocks and promotions can cover several
-- customers at once, the way they already cover several SKU ranges:
--
--   customer_ids set:   those customers (never an empty list).
--   customer_ids NULL:  every customer ("All customers").
--
-- customer_id stays, now optional: it is filled when an item names exactly
-- one customer (growth always does), so the growth unique index
-- (customer_id x range x year, 017) and its ON DELETE CASCADE keep working,
-- and code deployed before this change still reads one-customer items.
-- A list has no foreign key, so deleting a customer also takes its id out
-- of every list and deletes items left with none
-- (customer_service.delete_customer).
--
-- Additive and safe to rerun: existing rows get their one customer as a list.
BEGIN;

-- ---- building blocks ----------------------------------------------------

ALTER TABLE scenario_building_blocks
    ADD COLUMN IF NOT EXISTS customer_ids INTEGER[];

UPDATE scenario_building_blocks
SET customer_ids = ARRAY[customer_id]
WHERE customer_ids IS NULL AND customer_id IS NOT NULL;

ALTER TABLE scenario_building_blocks
    ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE scenario_building_blocks
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_customers_not_empty,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_customer_matches,
    DROP CONSTRAINT IF EXISTS ck_scenario_building_blocks_growth_one_customer;

ALTER TABLE scenario_building_blocks
    ADD CONSTRAINT ck_scenario_building_blocks_customers_not_empty
        CHECK (customer_ids IS NULL OR cardinality(customer_ids) > 0),
    -- customer_id is the list's one customer, or empty for several / all.
    ADD CONSTRAINT ck_scenario_building_blocks_customer_matches CHECK (
        customer_id IS NULL
        OR (customer_ids IS NOT NULL AND cardinality(customer_ids) = 1 AND customer_ids[1] = customer_id)
    ),
    -- Growth is per customer x range x year.
    ADD CONSTRAINT ck_scenario_building_blocks_growth_one_customer
        CHECK (kind <> 'growth' OR customer_id IS NOT NULL);

-- ---- promotions -------------------------------------------------------------

ALTER TABLE scenario_promotions
    ADD COLUMN IF NOT EXISTS customer_ids INTEGER[];

UPDATE scenario_promotions
SET customer_ids = ARRAY[customer_id]
WHERE customer_ids IS NULL AND customer_id IS NOT NULL;

ALTER TABLE scenario_promotions
    ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE scenario_promotions
    DROP CONSTRAINT IF EXISTS ck_scenario_promotions_customers_not_empty,
    DROP CONSTRAINT IF EXISTS ck_scenario_promotions_customer_matches;

ALTER TABLE scenario_promotions
    ADD CONSTRAINT ck_scenario_promotions_customers_not_empty
        CHECK (customer_ids IS NULL OR cardinality(customer_ids) > 0),
    ADD CONSTRAINT ck_scenario_promotions_customer_matches CHECK (
        customer_id IS NULL
        OR (customer_ids IS NOT NULL AND cardinality(customer_ids) = 1 AND customer_ids[1] = customer_id)
    );

COMMIT;
