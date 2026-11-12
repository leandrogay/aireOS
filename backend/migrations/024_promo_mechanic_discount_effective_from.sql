-- To run this migration in Cloud SQL, after 023_create_promo_calc.sql.

-- A mechanic's effective discount (the 30 in "30% Off", which the placeholder
-- rule and anchors use) now says which month it applies from, like anchor
-- versions (022). A discount edit applies from the month it is made in, so
-- the months before it keep the discount they had: the Scenario builder's
-- split of Tier 0 into the baseline and last year's promotions never jumps
-- for a past month when a discount is changed today.
--
--   effective_from NULL:  from the start (every row saved before this
--                         migration), so nothing that exists today moves.
--   effective_from set:   the first of the month the version applies from.
--
-- A mechanic's discount in month M is its row with the latest effective_from
-- on or before M (NULL counts as the earliest), the newest save winning
-- between rows with the same month (settings/common.in_effect). The table
-- stays append-only.
BEGIN;

ALTER TABLE promo_uplift_settings
    ADD COLUMN IF NOT EXISTS effective_from DATE;

ALTER TABLE promo_uplift_settings
    DROP CONSTRAINT IF EXISTS ck_promo_uplift_settings_effective_from;

ALTER TABLE promo_uplift_settings
    ADD CONSTRAINT ck_promo_uplift_settings_effective_from
        CHECK (effective_from IS NULL OR effective_from = date_trunc('month', effective_from));

COMMIT;
