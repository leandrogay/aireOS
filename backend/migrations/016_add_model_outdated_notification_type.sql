-- To run this migration in Cloud SQL.

-- One more kind of notification: the Gemini model an AI feature uses is no
-- longer available (app/services/ai_models.py). Until this runs, those
-- notifications are skipped (logged, never failing the upload or the question),
-- and the "AI unavailable" notices on the pages do not show either, because
-- they are read back from these rows.
-- Safe to run again: it replaces the constraint whatever it allowed before.
BEGIN;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check
    CHECK (notification_type IN (
        'low_stock',
        'forecast_success',
        'forecast_failure',
        'mapping_uploaded',
        'rollback_success',
        'rollback_failure',
        'model_outdated'
    ));

COMMIT;
