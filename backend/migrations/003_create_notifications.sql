-- To run this migration in Cloud SQL.

-- One shared notification feed for in-system alerts: low-stock/stockout
-- (from inventory_service, when a SKU written via Create/Edit/Upload drops
-- below its DOH threshold) and forecast pipeline success/failure (from
-- scripts/refresh_forecast.py). There is no per-user login anywhere in this
-- app, so read state is shared across everyone rather than per-account.
--
-- payload is structured JSON rather than pre-rendered text, so the wording
-- shown to staff lives in the frontend and can change without a migration.
BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    notification_type VARCHAR(30) NOT NULL
        CHECK (notification_type IN ('low_stock', 'forecast_success', 'forecast_failure')),
    -- customer_id/skus are set for low_stock only (NULL for forecast alerts,
    -- which are not scoped to one customer). They exist as their own columns,
    -- not just inside payload, so "is this SKU already flagged" is a plain
    -- WHERE/unnest rather than a nested JSONB match across two payload shapes
    -- (single SKU vs. the consolidated 5+ case).
    customer_id INTEGER REFERENCES customers(customer_id),
    skus TEXT[],
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications (created_at DESC) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_low_stock_dedup
    ON notifications (customer_id)
    WHERE notification_type = 'low_stock' AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recent
    ON notifications (created_at DESC);

COMMIT;
