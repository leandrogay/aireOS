-- Run in Singapore `aireos` after migration 007. Existing requests remain pending.
BEGIN;

ALTER TABLE public.forecast_refresh_requests
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'forecast_refresh_requests_status_check'
          AND conrelid = 'public.forecast_refresh_requests'::regclass
    ) THEN
        ALTER TABLE public.forecast_refresh_requests
            ADD CONSTRAINT forecast_refresh_requests_status_check
            CHECK (status IN ('pending', 'running', 'completed', 'failed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forecast_refresh_requests_status_created
    ON public.forecast_refresh_requests (status, created_at, id);

COMMIT;
