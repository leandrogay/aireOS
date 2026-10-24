-- To run this migration in Cloud SQL.

-- One more kind of notification: a mapping was approved for reuse. Until
-- this runs, that notification is skipped (logged, never failing the approval).
-- Safe to run again: it replaces the constraint whatever it allowed before.
BEGIN;

-- An earlier draft of this migration also allowed 'inventory_upload', a
-- notification that was then dropped; any written in the meantime would block
-- the stricter constraint below.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check
    CHECK (notification_type IN (
        'low_stock',
        'forecast_success',
        'forecast_failure',
        'mapping_uploaded'
    ));

COMMIT;
