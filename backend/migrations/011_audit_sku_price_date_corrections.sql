-- Run in Singapore aireos after 009_create_sku_price_periods.sql.
-- Restore periods for SKUs created while the history and period tables were
-- out of sync, then retain the original and corrected price and dates.
BEGIN;

WITH missing AS (
    SELECT sku FROM skus AS product
    WHERE NOT EXISTS (
        SELECT 1 FROM sku_price_periods AS period WHERE period.sku = product.sku
    )
), daily AS (
    SELECT DISTINCT ON (history.sku, history.price_effective_from)
        history.sku, history.price, history.price_effective_from AS starts_on,
        history.price_effective_to AS ends_on
    FROM sku_history AS history
    JOIN missing USING (sku)
    WHERE history.price_effective_from IS NOT NULL
      AND history.price IS NOT NULL
    ORDER BY history.sku, history.price_effective_from,
             history.changed_at DESC, history.sku_history_id DESC
), ordered AS (
    SELECT *, LEAD(starts_on) OVER (PARTITION BY sku ORDER BY starts_on) AS next_start
    FROM daily
)
INSERT INTO sku_price_periods (sku, price, effective_from, effective_to)
SELECT sku, price, starts_on,
       CASE WHEN next_start IS NULL THEN ends_on
            ELSE LEAST(COALESCE(ends_on, next_start - 1), next_start - 1)
       END
FROM ordered
ON CONFLICT (sku, effective_from) DO NOTHING;

-- A legacy SKU without dated history still needs one usable price period.
INSERT INTO sku_price_periods (sku, price, effective_from)
SELECT product.sku, product.price, DATE '1900-01-01'
FROM skus AS product
WHERE product.price IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM sku_price_periods AS period WHERE period.sku = product.sku
  )
ON CONFLICT (sku, effective_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS sku_price_period_corrections (
    correction_id BIGSERIAL PRIMARY KEY,
    price_period_id BIGINT NOT NULL REFERENCES sku_price_periods (price_period_id),
    sku VARCHAR(100) NOT NULL REFERENCES skus (sku),
    old_price NUMERIC(10, 2),
    new_price NUMERIC(10, 2),
    old_effective_from DATE NOT NULL,
    old_effective_to DATE,
    new_effective_from DATE NOT NULL,
    new_effective_to DATE,
    corrected_by TEXT NOT NULL,
    corrected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- This file can be re-run if the date-only audit table was already created.
ALTER TABLE sku_price_period_corrections
    ADD COLUMN IF NOT EXISTS old_price NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS new_price NUMERIC(10, 2);

UPDATE sku_price_period_corrections AS correction
SET old_price = COALESCE(correction.old_price, period.price),
    new_price = COALESCE(correction.new_price, period.price)
FROM sku_price_periods AS period
WHERE period.price_period_id = correction.price_period_id
  AND (correction.old_price IS NULL OR correction.new_price IS NULL);

ALTER TABLE sku_price_period_corrections
    ALTER COLUMN old_price SET NOT NULL,
    ALTER COLUMN new_price SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sku_price_corrections_sku
    ON sku_price_period_corrections (sku, corrected_at DESC, correction_id DESC);

GRANT SELECT, INSERT ON sku_price_period_corrections
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE sku_price_period_corrections_correction_id_seq
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";

COMMIT;
