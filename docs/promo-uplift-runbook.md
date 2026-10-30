# Promotion uplift: migrations and go-live runbook

**For:** Nisha (Part 1, Cloud SQL migrations and grants) and Sandra (Parts 3–5, go-live and day-to-day)
**Last updated:** 29 Oct 2026
**Background:** [docs/forecasting.md](forecasting.md) explains what all of this is for (Parts D–E).

> ## Status: READY TO RUN (29 Oct 2026)
> Migrations 006, 007 and 008 are final. 008 was amended on 29 Oct (before anyone ran it): `backtest_enabled` added, `stale_days` removed, new `triggered_by` values (including `settings_change`). Run them in the order below. Nothing else in `backend/migrations/` is part of this.
>
> **Changed 29 Oct:** the measurement now runs inside the API and reads only Cloud SQL. There is **no Cloud Run Job, no Cloud Scheduler, no BigQuery access and no `aireos-jobs` database user** to set up (Part 2).

---

## Contents

- [Part 1. For Nisha: run migrations 006, 007, 008](#part-1-for-nisha-run-migrations-006-007-008)
- [Part 2. Google Cloud job and scheduler: not needed](#part-2-google-cloud-job-and-scheduler-not-needed)
- [Part 3. For Sandra: go live in the app](#part-3-for-sandra-go-live-in-the-app)
- [Part 4. Day-to-day: checking, changing settings, troubleshooting](#part-4-day-to-day-checking-changing-settings-troubleshooting)
- [Part 5. Later (not now)](#part-5-later-not-now)

---

## Part 1. For Nisha: run migrations 006, 007, 008

### 1.1 In one paragraph

These three files create the database tables behind two new pages:
- **Forecast › Promotion Uplift Settings**, where users keep how much each kind of promotion lifts sales;
- **Forecast › Scenario builder › Promotions**, where users plan and save future promotions.

008 adds the tables for the measurement that works those values out from real sales data. The website's backend runs it by itself after a sales upload or a promotion change. **The three files only add new tables and their starting rows.** They don't change or delete anything that already exists.

### 1.2 Where and in what order

**Instance:** `aireos-postgresql` (project `aire-data`, region asia-southeast1, Singapore). **Database:** `aireos`. (The old `aire-postgresql` / `promotions` in us-central1 was replaced on 28 Oct 2026.) **Tool:** Cloud SQL Studio, or psql.

| Order | File (in `backend/migrations/`) | Creates | Needs first |
|---|---|---|---|
| 1 | `006_create_promo_uplift_settings.sql` | `promo_uplift_settings`, `promo_anchor_settings`, `promo_rule_settings`, 15 starting rows | `customers`, `skus` (exist) |
| 2 | `007_create_scenario_promotions.sql` | `scenario_promotions` (empty) | `customers`, `skus` |
| 3 | `008_create_promo_measurement.sql` | `promo_measurement_config` (1 row), `promo_measurement_runs`, `promo_measurement_results`, `promo_uplift_pending_notes` | **006** (008 points to its tables) |

**Why the order matters:** 008 has foreign keys to 006's tables, so running it first fails. 007 doesn't depend on 006 in the database, but the same page uses both.

**Should already be in place:** `003_create_sku_management.sql` and `004_consolidate_sku_versions.sql` (the app reads `skus.is_active`), and `004_create_scenario_building_blocks.sql`.

**About the numbers:** `main` already uses 003 twice, 004 three times and 005, so these start at 006. Nothing needs renaming.

### 1.3 How to run each file

1. Cloud SQL Studio → `aireos-postgresql` → database `aireos`.
2. Paste the **whole** file and run it. Each file is wrapped in `BEGIN; … COMMIT;`, so it applies completely or not at all.
3. Run its verification queries (1.6) and keep the output.
4. Go on to the next file only if the verification matches.

**If a statement fails:** PostgreSQL cancels the whole file. Run `ROLLBACK;` once, copy the error text exactly, and send it to Sandra. Please don't edit a file to make it pass.

**Running a file twice is harmless:** tables use `IF NOT EXISTS`, and starting rows use `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`.

### 1.4 What each table is

**006 `promo_uplift_settings`:** one uplift value per promotion mechanic, at one of four levels (all customers, customer, product range, SKU).
- **Append-only:** a change marks the old row `superseded_at` and inserts a new one. Nothing is updated in place or deleted.
- **Columns:** `mechanic_key` (e.g. `pct_off_30`), `mechanic_label` ("30% Off"), `effective_discount_pct`, `scope` + `customer_id`/`sku_range`/`sku` (a check makes them match), `uplift_pct` (−90 to 300; 4 = +4%), `source` (`rule_based`, `measured`, `estimate`, `learned`), `kind` (`promotion`/`voucher`), `evidence_months`, `note`, `changed_by`, `changed_at`, `superseded_at`, `archived_at`.
- **Unique index `uq_promo_uplift_current`:** only one current row per mechanic and scope.

**006 `promo_anchor_settings`:** each customer's ordinary-month discount (the "anchor" rule-based uplifts are worked out from). Append-only, one current row per customer.

**006 `promo_rule_settings`:** the rule behind rule-based uplifts, for all customers: one number, `uplift_per_point_pct` (% sales rise per extra point of discount deeper than the customer's normal discount; default **0.4**, so 5 points deeper → +2%). It must be more than 0 (CHECK); there is no upper limit. Append-only, one current row, seeded with 0.4 (`seed`). Edited on the settings page (recorded as `aireos`).

**007 `scenario_promotions`:** promotions planned in the Scenario builder.
- Saved straight away, switched on/off with `is_active`, removed with a real `DELETE` (like `scenario_building_blocks`).
- The uplift is **copied** when saved, so later settings changes never move a saved promotion.
- It never touches the real `promotions` table, the forecast, Inventory, Dashboard or BigQuery.

**008, for the measurement:**

| Table | Holds |
|---|---|
| `promo_measurement_config` | The measurement's settings, versioned: `starting_weight` 3, `min_exposure` 0.23, `reask_points` 2, `trend_min_months` 6, `backtest_tolerance_points` 1, `backtest_enabled` **false** (the backtest check is off; nothing reads BigQuery). One current row |
| `promo_measurement_runs` | One row per run, written once at the end: what triggered it (`upload`, `promotion_change`, `button`, `page_load`, `settings_change`), status, data window, input fingerprint (the same inputs never write twice), counts, warnings, error |
| `promo_measurement_results` | The evidence behind every measured value, per run |
| `promo_uplift_pending_notes` | "Measured uplift is now X (n months). Your uplift Y." notes on typed uplifts (and "Suggested from data: X. Your value: Y." on typed ordinary-month discounts), and the user's decision. One current note per target |

### 1.5 Permissions (GRANTs)

Only one database user is involved: the website's backend, which signs in with Google IAM (no password).

| Database user | Is | From |
|---|---|---|
| `aireos-api@aire-data.iam` | The website's backend, which also runs the measurement | `deploy/test/api.env.yaml` (`DB_IAM_USER`) |

**No `aireos-jobs` user is needed** for this (there is no measurement job any more).

Run these grants after all three files. Granting twice is harmless; leave out anything default privileges already give.

```sql
-- Settings (006) and measurement (008): read and write (UPDATE is only ever
-- used to fill in superseded_at)
GRANT SELECT, INSERT, UPDATE ON
    promo_uplift_settings, promo_anchor_settings, promo_rule_settings,
    promo_measurement_config, promo_measurement_runs,
    promo_measurement_results, promo_uplift_pending_notes
TO "aireos-api@aire-data.iam";

GRANT USAGE, SELECT ON SEQUENCE
    promo_uplift_settings_id_seq, promo_anchor_settings_id_seq, promo_rule_settings_id_seq,
    promo_measurement_config_id_seq, promo_measurement_runs_run_id_seq,
    promo_measurement_results_id_seq, promo_uplift_pending_notes_id_seq
TO "aireos-api@aire-data.iam";

-- Scenario promotions (007)
GRANT SELECT, INSERT, UPDATE, DELETE ON scenario_promotions TO "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE scenario_promotions_promotion_id_seq TO "aireos-api@aire-data.iam";

-- What the measurement reads (the website most likely reads these already)
GRANT SELECT ON
    sellout, promotions, promotion_stores, promotion_skus, stores, retailers,
    customer_retailers, customers, skus
TO "aireos-api@aire-data.iam";
```

### 1.6 Verification: what to run and what you should see

**After 006**

```sql
SELECT COUNT(*) FROM promo_uplift_settings WHERE superseded_at IS NULL;   -- 13
SELECT COUNT(*) FROM promo_uplift_settings WHERE kind = 'voucher';        -- 1
SELECT customer_id, anchor_pct, source FROM promo_anchor_settings;        -- (empty), 20.00, manual
SELECT uplift_per_point_pct, changed_by FROM promo_rule_settings;         -- 0.40, seed
SELECT DISTINCT source FROM promo_uplift_settings;                        -- rule_based
SELECT indexname FROM pg_indexes
WHERE tablename IN ('promo_uplift_settings', 'promo_anchor_settings', 'promo_rule_settings') ORDER BY indexname;
-- the three primary keys, uq_promo_anchor_current, uq_promo_rule_current, uq_promo_uplift_current
```

**After 007**

```sql
SELECT COUNT(*) FROM scenario_promotions;   -- 0
SELECT column_name FROM information_schema.columns
WHERE table_name = 'scenario_promotions' ORDER BY ordinal_position;
-- no reference_by_sku or voucher_by_sku
```

**After 008**

```sql
SELECT starting_weight, min_exposure, reask_points, trend_min_months, backtest_tolerance_points,
       backtest_enabled, changed_by
FROM promo_measurement_config WHERE superseded_at IS NULL;   -- 3.00, 0.230, 2.00, 6, 1.00, false, seed
SELECT COUNT(*) FROM promo_measurement_runs;                 -- 0
SELECT COUNT(*) FROM promo_measurement_results;              -- 0
SELECT COUNT(*) FROM promo_uplift_pending_notes;             -- 0
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'promo_measurement_runs'::regclass AND conname LIKE '%triggered_by%';
-- CHECK (triggered_by IN ('upload', 'promotion_change', 'button', 'page_load', 'settings_change'))
```

**After the grants**

```sql
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE grantee = 'aireos-api@aire-data.iam'
  AND table_name IN ('promo_uplift_settings', 'promo_anchor_settings', 'promo_rule_settings',
                     'promo_measurement_config', 'promo_measurement_runs', 'promo_measurement_results',
                     'promo_uplift_pending_notes', 'scenario_promotions', 'sellout', 'promotions',
                     'promotion_stores', 'promotion_skus', 'stores', 'retailers', 'customer_retailers',
                     'customers', 'skus')
GROUP BY table_name
ORDER BY table_name;
-- every table listed; SELECT on all of them
```

### 1.7 Undoing it

Before anyone uses the pages, dropping the tables is safe. Undo in **reverse** order. After the pages are in use, this deletes users' saved values and plans, so please ask Sandra first.

```sql
-- Undo 008
DROP TABLE IF EXISTS promo_uplift_pending_notes;
DROP TABLE IF EXISTS promo_measurement_results;
DROP TABLE IF EXISTS promo_measurement_runs;
DROP TABLE IF EXISTS promo_measurement_config;
-- Undo 007
DROP TABLE IF EXISTS scenario_promotions;
-- Undo 006
DROP TABLE IF EXISTS promo_rule_settings;
DROP TABLE IF EXISTS promo_anchor_settings;
DROP TABLE IF EXISTS promo_uplift_settings;
```

### 1.8 What to send back to Sandra

1. For each file: "ran OK", or the exact error text.
2. The output of every query in 1.6.

---

## Part 2. Google Cloud job and scheduler: not needed

**Removed on 29 Oct 2026.** The measurement used to be a daily Cloud Run Job (`aireos-promo-measure`) started by Cloud Scheduler at 04:00, signed in as `aireos-jobs`, reading BigQuery. It now runs inside the API:

| Before | Now |
|---|---|
| Cloud Run Job + Cloud Scheduler, daily 04:00 SGT | Inside the API, after a sales upload or a confirmed Load stores rows, after a promotion is created / edited / deleted, after a settings-page save that changed something (rule rate, anchors, uplift rows, Use measured), on **Re-measure**, and when the settings page opens if anything changed |
| `aireos-jobs` service account and database user, its grants and IAM roles | Nothing new: the API's own `aireos-api` user (Part 1.5) |
| BigQuery `fc_training_input` and `fc_backtest_forecasts` | Cloud SQL `sellout` only; the backtest check is off (`backtest_enabled = false`) |
| `scripts/measure_promo_uplifts.py` | Deleted; Re-measure does the same |

Nothing in Google Cloud needs setting up, and no Cloud Run setting changes: the measurement runs within the request that triggers it (an estimated 2–4 s when something changed), so Cloud Run's default CPU throttling after a response doesn't affect it.

If any of the old pieces were already created, they can be removed:

```
gcloud scheduler jobs delete aireos-promo-measure-daily --project aire-data --location asia-southeast1
gcloud run jobs delete aireos-promo-measure --project aire-data --region asia-southeast1
```

`deploy/test/jobs.env.yaml` stays: it belongs to the forecast jobs, not to this.

---

## Part 3. For Sandra: go live in the app

After Nisha confirms Part 1:

1. In `frontend/aireos/app/services/promoUpliftsApi.js`, set `PROMO_UPLIFTS_DEMO = false`. Delete `frontend/aireos/app/utils/promoUpliftsDemo.js` and the `import * as demo` line.
2. In `frontend/aireos/app/services/scenarioPromotionsApi.js`, set `SCENARIO_PROMOTIONS_DEMO = false` and remove its demo store.
3. Run `npm run lint` in `frontend/aireos` and `pytest` in `backend`.
4. Commit and deploy (`deploy/deploy.sh test`). That deploys the API with the measurement in it; there is nothing else to deploy.
5. **Browser checks.** For "a new run appears", check in Cloud SQL Studio:
   ```sql
   SELECT run_id, triggered_by, status, finished_at - started_at AS took, counts->>'applied' AS applied, error
   FROM promo_measurement_runs ORDER BY run_id DESC LIMIT 5;
   ```
   - **First open of Promotion Uplift Settings:** the panel briefly shows "Checking for new sales and promotions…", then "Last measured …". A `page_load` run appears; Fairprice rows turn **Measured** with months of evidence. Reload the page: **no** new run (nothing changed, and the page-load check records nothing when nothing changed).
   - **Settings page basics:**
     - Rule card says 0.4% (5 points deeper → +2%).
     - Each customer's anchor shows its source.
     - Edit a value → it becomes Estimate, and History shows two versions. Reset → back to Rule-based.
     - Archive → hidden unless "Show archived"; Restore brings it back.
     - Add "35% Off" → appears as a rule-based uplift at 35%.
     - Rule card → Edit → type 0.6: the preview shows the new rule-based uplifts; Save → the table moves, Measured/Estimate rows don't. Type 4 → the warning; 20 → rows show "capped at +300%". Reset to default → 0.4.
     - **Evidence** on a Measured row: "Backtest check" says **No check**.
   - **Change the rule rate** (Rule card → Edit → 0.6 → Save): the panel says "Updating measured uplifts…" while it saves, then a `settings_change` run appears (`succeeded`). The toast ends "· n measured uplifts updated" when Fairprice values moved; they move slightly (their starting point moved), while Rule-based rows move fully. Reset to default → another `settings_change` run. Saving the same rate again → "No changes to save" and **no** run.
   - **Archive a mechanic that has an open note** (type a Fairprice customer uplift first so a note exists): the note disappears in the same save, and the `settings_change` run's counts show `notes_closed`. **Keep mine** on a note adds no run.
   - **Re-measure:** with nothing changed → "Nothing has changed since the last measurement", and a `button` run with status `skipped_unchanged`.
   - **Upload a sales file** (Upload page, a file with a confirmed mapping; if it waits as Ready to load, press Load and confirm): the upload or Load succeeds as before, and an `upload` run appears (`succeeded`, or `skipped_unchanged` if the file only repeated data already loaded).
   - **Edit a promotion inside the measured months** (e.g. change the mechanic of a past Fairprice promotion, then change it back): each save succeeds and a `promotion_change` run appears with status `succeeded`.
   - **Create a promotion entirely in the future** (e.g. next month or later): it saves at the usual speed and the run is `skipped_unchanged` (future promotions don't change any measured value). Delete it afterwards: another `skipped_unchanged`.
   - **A forced measurement failure doesn't fail the upload or the promotion change** (test environment only). Ask Nisha to run `REVOKE SELECT ON promo_measurement_config FROM "aireos-api@aire-data.iam";` then:
     - edit a promotion → it still saves; a `promotion_change` run appears with status `failed` and a permission error;
     - upload a sales file → it still uploads; an `upload` run appears with status `failed`;
     - open the settings page → the amber warning "The latest measurement failed and changed nothing, so measured uplifts are from …" with the error.

     Then ask Nisha to run `GRANT SELECT ON promo_measurement_config TO "aireos-api@aire-data.iam";` and press **Re-measure**: the warning goes away.
   - **Notes:** type a Fairprice customer uplift for a measured mechanic, then Re-measure → a note appears ("Measured uplift is now X (n months). Your uplift: Y."). Keep mine → it goes away. Use measured → the value turns Measured.
   - **Scenario builder → Promotions:**
     - Pick Fairprice and one SKU → the dropdown shows that SKU's value with "(Measured · n months)" where it has one.
     - Add a side offer and a monthly promotion in the same month → the Simulated line moves by the replace rule.
     - Save and reload → still there.

---

## Part 4. Day-to-day: checking, changing settings, troubleshooting

### 4.1 Is it working?

The settings page shows "Last measured …", and an amber warning when the latest run failed. Or in Cloud SQL:

```sql
SELECT run_id, triggered_by, status, finished_at, finished_at - started_at AS took,
       counts->>'applied' AS applied, warnings, error
FROM promo_measurement_runs ORDER BY run_id DESC LIMIT 10;
```

A new month of sales, a change to a promotion in the measured months, or a settings-page save (`settings_change`) gives a `succeeded` run; re-uploads, future-only promotions and Re-measure with nothing new give `skipped_unchanged`. The page-load check only leaves a row when it measured.

### 4.2 Changing a setting (starting weight, minimum exposure, …)

Settings are versioned. Add a new version (copy the current values and change one), in Cloud SQL Studio:

```sql
BEGIN;
UPDATE promo_measurement_config SET superseded_at = now() WHERE superseded_at IS NULL;
INSERT INTO promo_measurement_config
    (starting_weight, min_exposure, reask_points, trend_min_months, backtest_tolerance_points, backtest_enabled, changed_by)
VALUES (3, 0.23, 2, 6, 1, FALSE, '<your name>');
COMMIT;
```

SQL changes like this can't trigger a measurement themselves. They're picked up at the next page open or Re-measure (or the next upload, promotion change or settings save), because they're part of the fingerprint.

**Switching the backtest check on** is the same insert with `backtest_enabled` TRUE, but only after the BigQuery pipeline change ([forecasting.md Part C](forecasting.md#part-c-pipeline-change-keep-every-backtest-months-forecast)) is deployed and the API's service account has BigQuery Job User on `aire-data` and Data Viewer on `Aire_Data_Analytics`.

### 4.3 Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| Amber "latest measurement failed" warning; run `failed`, error mentions permission denied | A grant from Part 1.5 is missing | Part 1.5, then Re-measure |
| Run `failed`: "sellout has no complete months from January 2025 before this month" | No sales uploaded yet, or none that reach a month's end | Upload sales; the next upload measures by itself |
| Run `failed`, error mentions the database connection | Cloud SQL unreachable from the API | Check the API logs (Cloud Run → `aireos-api` → Logs, severity ERROR); uploads and promotion saves still work |
| `succeeded_with_warnings`: "cannot be read" | A promotion label like "Free gift" | Fix the label on the Promotions page, or accept it isn't measured |
| Re-measure says "already in progress" | An upload, promotion save or another click is measuring | Try again in a minute |
| A new upload or promotion change left no run | Another run held the lock at that moment (nothing is recorded then), or the upload stored no rows | Open the settings page: its check measures if anything changed |
| The latest month isn't measured | It's the current month, or that customer's data doesn't reach the month's last day yet | Expected; it counts once the month is complete and uploaded |
| Uploads, promotion saves or settings saves feel slower | A measurement runs in the same request (estimated 2–4 s when something changed) | Check `took` in 4.1; if it grows a lot, consider a background task with `--no-cpu-throttling` (forecasting.md E4) |

---

## Part 5. Later (not now)

**Bell notifications for the measurement:**
- One small migration that widens the existing `notifications` type check (same pattern as `004_add_mapping_notification_type.sql`) with `promo_uplift_pending` and `promo_measurement_failure`.
- The measurement writes one per run with `notification_service.insert_best_effort` (never failing the run).
- The notes table stays the source of truth, since notifications are deleted after 60 days.

**The backtest check:** see 4.2.
