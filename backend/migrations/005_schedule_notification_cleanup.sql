-- To run this migration in Cloud SQL, in the `promotions` database.

-- Deletes notifications older than 60 days, read or unread, every day at
-- 18:00 UTC (02:00 Singapore). The database does it itself with pg_cron, so it
-- runs whether or not the backend is up. Deleting any also sends the same
-- NOTIFY the app sends, so open notification bells update.
--
-- Needs two Cloud SQL database flags set first (setting them restarts the
-- instance once):
--   cloudsql.enable_pg_cron = on
--   cron.database_name      = promotions
--
-- Safe to run again: scheduling a job under an existing name replaces it.
-- To change the 60 days or the time, edit and re-run this file.
-- To check it: SELECT * FROM cron.job;  and its runs: SELECT * FROM cron.job_run_details ORDER BY start_time DESC;
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'delete-expired-notifications',
    '0 18 * * *',
    $job$
    WITH deleted AS (
        DELETE FROM notifications
        WHERE created_at < now() - INTERVAL '60 days'
        RETURNING 1
    )
    SELECT pg_notify('notifications_changed', '')
    WHERE EXISTS (SELECT 1 FROM deleted)
    $job$
);

COMMIT;
