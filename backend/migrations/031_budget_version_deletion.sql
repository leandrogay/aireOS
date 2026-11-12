-- Apply by hand after 030. A budget version deleted in the app is only
-- hidden: its header and rows stay for the record, stamped with who deleted
-- it and when. A deleted version is never official (the app refuses to
-- delete the official one or make a deleted one official).
BEGIN;
ALTER TABLE budget_snapshots ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE budget_snapshots ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE budget_snapshots DROP CONSTRAINT IF EXISTS budget_snapshots_deleted_not_official;
ALTER TABLE budget_snapshots ADD CONSTRAINT budget_snapshots_deleted_not_official
    CHECK (deleted_at IS NULL OR NOT is_official);
COMMIT;
