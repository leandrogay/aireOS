-- Apply by hand after 029. Budget versions get an optional name and one
-- official version per year: the one Forecast and Inventory draw as Budget.
-- Locking a version no longer replaces what the charts show unless it is
-- made official.
BEGIN;
ALTER TABLE budget_snapshots ADD COLUMN IF NOT EXISTS name TEXT
    CHECK (name IS NULL OR length(name) BETWEEN 1 AND 80);
ALTER TABLE budget_snapshots ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE;

-- Before this migration the newest lock was the one shown; it stays shown.
UPDATE budget_snapshots SET is_official = TRUE
WHERE snapshot_id IN (SELECT DISTINCT ON (year) snapshot_id FROM budget_snapshots ORDER BY year, version DESC)
    AND NOT EXISTS (SELECT 1 FROM budget_snapshots official WHERE official.year = budget_snapshots.year AND official.is_official);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_snapshots_official_year ON budget_snapshots (year) WHERE is_official;
COMMIT;
