-- To run this migration in Cloud SQL, after 023_create_promo_calc.sql.

-- "Buy 2 Get P% Off" mechanics count their discount per piece, as revenue
-- estimation already does (docs/promotion-pricing-and-import.md: the paid
-- share is 1 - P / (100 x N)): the P% comes off one of the two units, so each
-- unit sells for P / 2 % less. 012 seeded them at the headline P (25, 30),
-- while the "free" mechanics were already per piece (Buy 2 Get 1 Free 33.3,
-- Buy 1 Get 1 Free 50). The placeholder rule and anchor conversions compare
-- these discounts with the anchor's, so they must all be measured one way.
--
--   Buy 2 Get 25% Off   25 -> 12.5   placeholder uplift +2 -> -3
--   Buy 2 Get 30% Off   30 -> 15     placeholder uplift +4 -> -2
--
-- The headline values were a seeding mistake, not a change, so the seed rows
-- themselves are corrected in place: they stay the mechanics' starting values
-- ("Starting value", from the start), and 012 now seeds the per-piece values,
-- so a new database needs nothing from this file. This is the one deliberate
-- exception to the table being append-only. A version saved on the page later
-- is left as it is.
--
-- An earlier draft of this migration added new versions instead (updated_by
-- 'migration 032'); they are removed, so the history shows one starting value.
--
-- Re-running changes nothing. The recalculation is queued, not run: press
-- Recalculate on Promotion uplift settings (or run
-- scripts/rebuild_promo_calc.py) after applying this.
BEGIN;

DELETE FROM promo_uplift_settings
WHERE updated_by = 'migration 032';

WITH target (promotion_mechanic, discount_pct) AS (
    VALUES
        ('Buy 2 Get 25% Off', 12.5),
        ('Buy 2 Get 30% Off', 15)
),
corrected AS (
    UPDATE promo_uplift_settings u
    SET effective_discount_pct = t.discount_pct,
        -- A placeholder follows the discount, at the 20% fallback anchor as
        -- 012 seeded it: (discount - 20) / 5 x 2, to a whole percent.
        uplift_pct = CASE
            WHEN u.source = 'placeholder' THEN round((t.discount_pct - 20) / 5 * 2)
            ELSE u.uplift_pct
        END
    FROM target t
    WHERE u.promotion_mechanic = t.promotion_mechanic
        AND u.updated_by = 'seed'
        AND u.customer_id IS NULL
        AND u.sku_range IS NULL
        AND u.sku IS NULL
        AND u.effective_discount_pct IS DISTINCT FROM t.discount_pct
    RETURNING u.uplift_id
)
-- Every customer is worked out again, as after a discount saved on the page.
INSERT INTO promo_recalc_requests (customer_id, reason, source)
SELECT NULL, 'mechanic_change', 'promo_uplift_settings'
WHERE EXISTS (SELECT 1 FROM corrected);

COMMIT;
