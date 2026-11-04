-- Run in Singapore aireos before deploying the effective-dated SKU form.
-- Existing SKU price snapshots are converted into calendar-day periods.
BEGIN;

ALTER TABLE sku_history
    ADD COLUMN IF NOT EXISTS price_effective_from DATE,
    ADD COLUMN IF NOT EXISTS price_effective_to DATE;

CREATE TABLE IF NOT EXISTS sku_price_periods (
    price_period_id BIGSERIAL PRIMARY KEY,
    sku VARCHAR(100) NOT NULL REFERENCES skus (sku),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    effective_from DATE NOT NULL,
    effective_to DATE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT sku_price_period_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    ),
    CONSTRAINT sku_price_period_start UNIQUE (sku, effective_from)
);

-- The old system treated the first recorded price as the price even before
-- SKU history began. Keep that assumption for already-ingested sales.
WITH first_dated AS (
    SELECT sku, MIN(price_effective_from) AS first_start
    FROM sku_history
    WHERE price_effective_from IS NOT NULL
    GROUP BY sku
), daily AS (
    SELECT DISTINCT ON (
        history.sku,
        COALESCE(history.price_effective_from,
                 (history.changed_at AT TIME ZONE 'Asia/Singapore')::DATE)
    )
        history.sku, history.price,
        COALESCE(history.price_effective_from,
                 (history.changed_at AT TIME ZONE 'Asia/Singapore')::DATE) AS changed_day,
        history.price_effective_to AS explicit_end,
        history.price_effective_from IS NOT NULL AS is_dated
    FROM sku_history AS history
    LEFT JOIN first_dated USING (sku)
    WHERE history.action <> 'archived' AND history.price IS NOT NULL
      AND (history.price_effective_from IS NOT NULL
           OR first_dated.first_start IS NULL
           OR (history.changed_at AT TIME ZONE 'Asia/Singapore')::DATE
              < first_dated.first_start)
    ORDER BY history.sku,
             COALESCE(history.price_effective_from,
                      (history.changed_at AT TIME ZONE 'Asia/Singapore')::DATE),
             history.changed_at DESC, history.sku_history_id DESC
), changes AS (
    SELECT *, LAG(price) OVER (PARTITION BY sku ORDER BY changed_day) AS prior_price
    FROM daily
), distinct_prices AS (
    SELECT sku, price, changed_day, explicit_end, is_dated,
           ROW_NUMBER() OVER (PARTITION BY sku ORDER BY changed_day) AS position,
           LEAD(changed_day) OVER (PARTITION BY sku ORDER BY changed_day) AS next_day
    FROM changes
    WHERE is_dated OR prior_price IS DISTINCT FROM price
)
INSERT INTO sku_price_periods (sku, price, effective_from, effective_to)
SELECT sku, price,
       CASE WHEN position = 1 AND NOT is_dated
            THEN DATE '1900-01-01' ELSE changed_day END,
       CASE WHEN next_day IS NULL THEN explicit_end
            ELSE LEAST(COALESCE(explicit_end, next_day - 1), next_day - 1)
       END
FROM distinct_prices
ON CONFLICT (sku, effective_from) DO NOTHING;

INSERT INTO sku_price_periods (sku, price, effective_from)
SELECT sku, price, DATE '1900-01-01'
FROM skus AS product
WHERE price IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sku_price_periods AS period WHERE period.sku = product.sku)
ON CONFLICT (sku, effective_from) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_sku_price_periods_lookup
    ON sku_price_periods (sku, effective_from DESC);

GRANT SELECT, INSERT, UPDATE ON sku_price_periods
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE sku_price_periods_price_period_id_seq
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";

COMMIT;
