-- Run against the Singapore `aireos` database as its PostgreSQL admin.
-- The inbox must be in the same database as sales and promotions so a save
-- can record its refresh request in the same transaction.
BEGIN;

CREATE TABLE IF NOT EXISTS public.forecast_refresh_requests (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('sales_upload', 'promotion_change')),
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dispatched_at TIMESTAMPTZ,
    job_id TEXT
);

GRANT SELECT, INSERT, UPDATE ON public.forecast_refresh_requests
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE public.forecast_refresh_requests_id_seq
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
GRANT SELECT ON public.forecast_refresh_requests TO datastream_sellout;

-- The existing publication is owned by postgres. The Datastream stream must
-- also include this table in its source-object selection after it is created.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'aireos_sellout_pub'
          AND schemaname = 'public'
          AND tablename = 'forecast_refresh_requests'
    ) THEN
        ALTER PUBLICATION aireos_sellout_pub
            ADD TABLE public.forecast_refresh_requests;
    END IF;
END;
$$;

COMMIT;
