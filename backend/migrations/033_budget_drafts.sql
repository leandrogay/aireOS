-- Apply by hand after 031. What each year's Budget planning draft (its saved
-- entries, the "Budget scenario" line) was started from: a copy of a locked
-- version, or nothing (from scratch, Initial alone). Written by "Start
-- from..." (budgets.start_budget) in the same transaction as the copy. Until
-- a year has a row, adding its first building block or promotion asks where
-- to start. started_from_version is a number, not a foreign key, so a
-- version deleted later still says where the draft came from.
BEGIN;
CREATE TABLE IF NOT EXISTS budget_drafts (
    year INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
    started_from_version INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_by TEXT NOT NULL
);
-- Same service accounts as 021_create_scenario_promotions.sql. No sequence:
-- the year is the key.
GRANT SELECT, INSERT, UPDATE ON budget_drafts
    TO "teamwip-backend-storage@aire-data.iam", "aireos-api@aire-data.iam";
COMMIT;
