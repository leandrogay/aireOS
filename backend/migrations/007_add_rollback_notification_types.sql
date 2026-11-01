-- To run this migration in Cloud SQL.

-- Two more kinds of notification: an upload rollback that succeeded, and one
-- that failed (ingestion_service.rollback_upload). Until this runs, those
-- notifications are skipped (logged, never failing the rollback).
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
        'rollback_failure'
    ));

COMMIT;
