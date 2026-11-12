-- To run this migration in Cloud SQL, after 027_scenario_growth_per_customer.sql.

-- A Scenario builder promotion can cover several customers (025), and each
-- customer takes its own uplift: the values copied in from Promotion uplift
-- settings when it was set up are kept per customer, keyed by customer id
-- (so renaming a customer keeps them):
--
--   references_by_customer = {"1": {"reference_uplift_pct": 4, "reference_source": "measured",
--                                   "reference_by_sku": {...}, "voucher_uplift_pct": 3,
--                                   "voucher_by_sku": {...}}, ...}
--
-- The single reference_* / voucher_* columns stay and carry the first
-- customer's values, for code that reads one. A promotion saved before this
-- has '{}' and keeps using them for its one customer.
--
-- Additive and safe to rerun.
BEGIN;

ALTER TABLE scenario_promotions
    ADD COLUMN IF NOT EXISTS references_by_customer JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE scenario_promotions
    DROP CONSTRAINT IF EXISTS ck_scenario_promotions_references_by_customer_object;

ALTER TABLE scenario_promotions
    ADD CONSTRAINT ck_scenario_promotions_references_by_customer_object
        CHECK (jsonb_typeof(references_by_customer) = 'object');

COMMIT;
