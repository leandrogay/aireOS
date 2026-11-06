-- To run this migration in Cloud SQL.

-- The sell-in plan as it stood after a forecast refresh, so the sell-in plan
-- chart can draw "Sell-in Forecast (Previous)": what the platform recommended
-- last month, not a recomputation on today's stock. Written by
-- app/services/sell_in_snapshots.py each time a forecast refresh retrains
-- (the event-triggered refresh and the scheduled run), read by
-- inventory_service.get_sell_in_outlook.
--
-- One snapshot per customer per month (snapshot_month, first of the UTC
-- month): a second refresh in the same month replaces that month's rows, so
-- the snapshot left at the month's end is the plan as it stood then.
-- Earlier months are never changed. Deleting a customer deletes its rows.
BEGIN;

CREATE TABLE IF NOT EXISTS sell_in_plan_snapshots (
    snapshot_row_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL REFERENCES skus(sku),
    snapshot_month DATE NOT NULL,
    plan_month DATE NOT NULL,
    recommended_sell_in DOUBLE PRECISION NOT NULL CHECK (recommended_sell_in >= 0),
    taken_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_sell_in_plan_snapshots_months
        CHECK (EXTRACT(DAY FROM snapshot_month) = 1 AND EXTRACT(DAY FROM plan_month) = 1),
    CONSTRAINT uq_sell_in_plan_snapshots
        UNIQUE (customer_id, snapshot_month, sku, plan_month)
);

GRANT SELECT, INSERT, DELETE ON sell_in_plan_snapshots
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE sell_in_plan_snapshots_snapshot_row_id_seq
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";

COMMIT;
