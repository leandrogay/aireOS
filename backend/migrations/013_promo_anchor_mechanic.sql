-- To run this migration in Cloud SQL, after 012_create_promo_uplift_settings.sql.

-- A customer's (or SKU range's) anchor is now a promotion mechanic: the one
-- it most often runs as a whole-month promotion ("moments", counted by
-- mechanic over the last 12 months), saved once and never recalculated by
-- itself. Someone adopts a newer recommendation when the usual mechanic
-- shifts. Only where there are too few moments to recommend from can a
-- discount be typed in by hand instead ('manual', no mechanic).
--
-- anchor_pct stays on every row: the discount placeholder uplifts are
-- measured from (the mechanic's effective discount for 'recommended').
-- The table was empty when this ran, so the old 'suggested' rows (a reset
-- to "use the data") never existed and need no conversion.
BEGIN;

ALTER TABLE promo_anchor_settings
    ADD COLUMN IF NOT EXISTS promotion_mechanic VARCHAR(120);

ALTER TABLE promo_anchor_settings
    ALTER COLUMN anchor_pct SET NOT NULL;

ALTER TABLE promo_anchor_settings
    DROP CONSTRAINT IF EXISTS ck_promo_anchor_settings_source,
    DROP CONSTRAINT IF EXISTS ck_promo_anchor_settings_manual_pct,
    DROP CONSTRAINT IF EXISTS ck_promo_anchor_settings_mechanic;

ALTER TABLE promo_anchor_settings
    ADD CONSTRAINT ck_promo_anchor_settings_source
        CHECK (source IN ('recommended', 'manual')),
    -- A recommended anchor names its mechanic; a typed one has none.
    ADD CONSTRAINT ck_promo_anchor_settings_mechanic
        CHECK ((source = 'recommended') = (promotion_mechanic IS NOT NULL));

COMMIT;
