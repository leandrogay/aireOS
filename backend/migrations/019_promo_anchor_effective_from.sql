-- To run this migration in Cloud SQL, after 018_create_scenario_promotions.sql.

-- An anchor version now says which month it applies from, so a change to the
-- usual discount that is already decided for the future (promotions keyed in
-- on the Promotions page, e.g. 20% off becoming 15% off from Dec 2026) is
-- saved ahead of time without changing the months before it.
--
--   effective_from NULL:  from the start (every row saved before this
--                         migration), so nothing that exists today moves.
--   effective_from set:   the first of the month the version applies from.
--
-- A target's anchor in month M is its row with the latest effective_from on
-- or before M (NULL counts as the earliest), the newest save winning between
-- rows with the same month (settings/common.in_effect). Edits and adoptions
-- apply from the month they are made in, so they replace today's anchor and
-- leave a later change in place. The table stays append-only.
--
-- 'projected' rows are the future changes worked out from the official
-- promotions and saved automatically (always a later month than the one they
-- are saved in); like 'recommended' they name the mechanic. A 'manual' or
-- 'recommended' row for the same target from the same month replaces one.
BEGIN;

ALTER TABLE promo_anchor_settings
    ADD COLUMN IF NOT EXISTS effective_from DATE;

ALTER TABLE promo_anchor_settings
    DROP CONSTRAINT IF EXISTS ck_promo_anchor_settings_effective_from,
    DROP CONSTRAINT IF EXISTS ck_promo_anchor_settings_source,
    DROP CONSTRAINT IF EXISTS ck_promo_anchor_settings_mechanic;

ALTER TABLE promo_anchor_settings
    ADD CONSTRAINT ck_promo_anchor_settings_effective_from
        CHECK (effective_from IS NULL OR effective_from = date_trunc('month', effective_from)),
    ADD CONSTRAINT ck_promo_anchor_settings_source
        CHECK (source IN ('recommended', 'manual', 'projected')),
    -- A recommended or projected anchor names its mechanic; a typed one has none.
    ADD CONSTRAINT ck_promo_anchor_settings_mechanic
        CHECK ((source IN ('recommended', 'projected')) = (promotion_mechanic IS NOT NULL));

COMMIT;
