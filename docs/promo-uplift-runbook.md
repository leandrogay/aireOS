# Promotion uplift: migrations and Google Cloud runbook

**For:** Nisha (Part 1, Cloud SQL migrations) and Sandra (Parts 2–5, Google Cloud setup and go-live)
**Last updated:** 28 Oct 2026
**Background:** [docs/forecasting.md](forecasting.md) explains what all of this is for (Parts D–E).

> ## Status: READY TO RUN (28 Oct 2026)
> Migrations 006, 007 and 008 are final. Run them in the order below. Nothing else in `backend/migrations/` is part of this.

---

## Contents

- [Part 1. For Nisha: run migrations 006, 007, 008](#part-1-for-nisha-run-migrations-006-007-008)
- [Part 2. For Sandra: Google Cloud setup for the measurement job](#part-2-for-sandra-google-cloud-setup-for-the-measurement-job)
- [Part 3. For Sandra: go live in the app](#part-3-for-sandra-go-live-in-the-app)
- [Part 4. Day-to-day: checking, changing settings, troubleshooting](#part-4-day-to-day-checking-changing-settings-troubleshooting)
- [Part 5. Later (not now)](#part-5-later-not-now)

---

## Part 1. For Nisha: run migrations 006, 007, 008

### 1.1 In one paragraph

These three files create the database tables behind two new pages:
- **Forecast › Promotion Uplift Settings**, where users keep how much each kind of promotion lifts sales;
- **Forecast › Scenario builder › Promotions**, where users plan and save future promotions.

008 adds the tables for a daily job that measures those values from real sales data. **The three files only add new tables and their starting rows.** They don't change or delete anything that already exists.

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

**008, for the measurement job:**

| Table | Holds |
|---|---|
| `promo_measurement_config` | The job's settings, versioned (starting weight (k) 3, minimum exposure 0.23, re-ask 2 points, stale after 100 days, trend from 6 months, backtest tolerance 1 point). One current row |
| `promo_measurement_runs` | One row per run, written once at the end: status, data window, input fingerprint (the same inputs never write twice), counts, warnings, error |
| `promo_measurement_results` | The evidence behind every measured value, per run |
| `promo_uplift_pending_notes` | "Measured value is now X; your value Y" notes on typed values, and the user's decision. One current note per target |

### 1.5 Permissions (GRANTs)

Two database users sign in with Google IAM (no passwords):

| Database user | Is | From |
|---|---|---|
| `aireos-api@aire-data.iam` | The website's backend | `deploy/test/api.env.yaml` (`DB_IAM_USER`) |
| `aireos-jobs@aire-data.iam` | The daily measurement job | `deploy/test/jobs.env.yaml` (`DB_IAM_USER`) |

**If `aireos-jobs@aire-data.iam` isn't a database user yet**, add it first: Cloud SQL → `aireos-postgresql` → **Users** → **Add user account** → **Cloud IAM**, principal `aireos-jobs@aire-data.iam.gserviceaccount.com`. Or:

```
gcloud sql users create aireos-jobs@aire-data.iam --instance=aireos-postgresql --type=cloud_iam_service_account --project=aire-data
```

Then run these grants (after all three files). Granting twice is harmless; leave out anything default privileges already give.

```sql
-- Settings (006) and measurement (008): both users read and write (UPDATE is only
-- ever used to fill in superseded_at)
GRANT SELECT, INSERT, UPDATE ON
    promo_uplift_settings, promo_anchor_settings, promo_rule_settings,
    promo_measurement_config, promo_measurement_runs,
    promo_measurement_results, promo_uplift_pending_notes
TO "aireos-api@aire-data.iam", "aireos-jobs@aire-data.iam";

GRANT USAGE, SELECT ON SEQUENCE
    promo_uplift_settings_id_seq, promo_anchor_settings_id_seq, promo_rule_settings_id_seq,
    promo_measurement_config_id_seq, promo_measurement_runs_run_id_seq,
    promo_measurement_results_id_seq, promo_uplift_pending_notes_id_seq
TO "aireos-api@aire-data.iam", "aireos-jobs@aire-data.iam";

-- Scenario promotions (007): the website only
GRANT SELECT, INSERT, UPDATE, DELETE ON scenario_promotions TO "aireos-api@aire-data.iam";
GRANT USAGE, SELECT ON SEQUENCE scenario_promotions_promotion_id_seq TO "aireos-api@aire-data.iam";

-- What the job reads (the website already reads these)
GRANT SELECT ON
    promotions, promotion_stores, promotion_skus, stores, retailers,
    customer_retailers, customers, skus, sellout
TO "aireos-jobs@aire-data.iam";
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
SELECT k, min_exposure, reask_points, stale_days, trend_min_months, backtest_tolerance_points, changed_by
FROM promo_measurement_config WHERE superseded_at IS NULL;   -- 3.00, 0.230, 2.00, 100, 6, 1.00, seed
SELECT COUNT(*) FROM promo_measurement_runs;                 -- 0
SELECT COUNT(*) FROM promo_measurement_results;              -- 0
SELECT COUNT(*) FROM promo_uplift_pending_notes;             -- 0
```

**After the grants**

```sql
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE grantee IN ('aireos-api@aire-data.iam', 'aireos-jobs@aire-data.iam')
  AND table_name LIKE ANY (ARRAY['promo_%', 'scenario_promotions', 'sellout', 'promotions'])
GROUP BY grantee, table_name
ORDER BY grantee, table_name;
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
3. Whether you had to add the `aireos-jobs@aire-data.iam` database user.

---

## Part 2. For Sandra: Google Cloud setup for the measurement job

Do this **after Nisha confirms Part 1**, and after the branch is committed and the API redeployed (the job runs from the API image).

### 2.1 What gets set up

| Piece | Name | Does |
|---|---|---|
| Cloud Run **Job** | `aireos-promo-measure` | Runs `python -m scripts.measure_promo_uplifts` from the API image, as `aireos-jobs` |
| Cloud Scheduler job | `aireos-promo-measure-daily` | Starts it daily at 04:00 Singapore time (2 hours after the 02:00 retrain, so they never overlap) |

**No sign-in check is needed in the app:** the scheduler starts a Cloud Run **Job**, not a web request, so the website's sign-in rule is untouched. The settings page's **Re-measure** button uses your normal app sign-in and runs the same code.

### 2.2 Roles to request up front

**For you** (to set it up): Cloud Run Admin (`roles/run.admin`), Cloud Scheduler Admin (`roles/cloudscheduler.admin`), Service Account User (`roles/iam.serviceAccountUser`) on `aireos-jobs@aire-data.iam.gserviceaccount.com`.

**For `aireos-jobs@aire-data.iam.gserviceaccount.com`:**

| Role | Where | Why |
|---|---|---|
| BigQuery Job User (`roles/bigquery.jobUser`) | project `aire-data` | Every BigQuery read runs as a query job. **No write access** |
| BigQuery Data Viewer (`roles/bigquery.dataViewer`) | dataset `Aire_Data_Analytics` | Read `fc_training_input` and `fc_backtest_forecasts` |
| Cloud SQL Client (`roles/cloudsql.client`) | project `aire-data` | Connect to `aireos-postgresql` |
| Cloud SQL Instance User (`roles/cloudsql.instanceUser`) | project `aire-data` | Sign in to Postgres as itself, no password |
| Cloud Run Invoker (`roles/run.invoker`) | the job `aireos-promo-measure` | Lets the scheduler (running as this account) start the job |

What it can touch **inside** the database is limited by Nisha's grants (1.5).

To check an account's project roles:

```
gcloud projects get-iam-policy aire-data --flatten="bindings[].members" --filter="bindings.members:serviceAccount:aireos-jobs@aire-data.iam.gserviceaccount.com" --format="table(bindings.role)"
```

### 2.3 Deploy the job

Use the image tag the API was last deployed with (`deploy.sh` prints "Deployed test at <tag>"; the image is `asia-southeast1-docker.pkg.dev/aire-data/aireos-test/api:<tag>`):

```
gcloud run jobs deploy aireos-promo-measure --project aire-data --region asia-southeast1 \
  --image asia-southeast1-docker.pkg.dev/aire-data/aireos-test/api:<tag> \
  --command python --args=-m,scripts.measure_promo_uplifts \
  --service-account aireos-jobs@aire-data.iam.gserviceaccount.com \
  --env-vars-file deploy/test/jobs.env.yaml \
  --max-retries 1 --task-timeout 15m
```

Whenever the API is redeployed with a new tag, rerun this with the same tag, so the job runs the same code as the site.

Allow the job's own account to start it (used by the scheduler):

```
gcloud run jobs add-iam-policy-binding aireos-promo-measure --project aire-data --region asia-southeast1 \
  --member serviceAccount:aireos-jobs@aire-data.iam.gserviceaccount.com --role roles/run.invoker
```

### 2.4 Schedule it (daily 04:00 SGT)

```
gcloud scheduler jobs create http aireos-promo-measure-daily --project aire-data --location asia-southeast1 \
  --schedule "0 4 * * *" --time-zone "Asia/Singapore" --http-method POST \
  --uri "https://run.googleapis.com/v2/projects/aire-data/locations/asia-southeast1/jobs/aireos-promo-measure:run" \
  --oauth-service-account-email aireos-jobs@aire-data.iam.gserviceaccount.com
```

The page's "next run" assumes 04:00 SGT (`SCHEDULE_HOUR_SGT` in `promo_measurement.py`). If you change the schedule, change that number too.

### 2.5 Test it by hand

```
gcloud run jobs execute aireos-promo-measure --project aire-data --region asia-southeast1 --wait
```

Then check:

1. **Cloud Run → Jobs → aireos-promo-measure → the execution → Logs.** It prints a summary with `status` (`succeeded`) and `counts` (e.g. `applied`, `notes_opened`, `mechanics_created`).
2. **In Cloud SQL Studio:**
   ```sql
   SELECT run_id, triggered_by, status, window_start, window_end, counts, warnings, error
   FROM promo_measurement_runs ORDER BY run_id DESC LIMIT 5;
   ```
3. **The settings page:** "Last measured …" is filled in; Fairprice rows show **Measured** with months of evidence; **Evidence** in a row's menu shows the details.
4. **Run it again:** the new run should be `skipped_unchanged` (nothing changed).
5. **Test the scheduler** without waiting for 04:00: `gcloud scheduler jobs run aireos-promo-measure-daily --project aire-data --location asia-southeast1`, then repeat check 1.

### 2.6 Failure alerts

Being set up separately with teammates. What any alert can rely on:
- a failed run makes the **job execution fail** (exit code 1);
- it **logs at ERROR level**;
- it writes a `failed` row in `promo_measurement_runs` with the error;
- unreadable promotion labels also log at ERROR (the run still succeeds, as `succeeded_with_warnings`).

The settings page shows the last failure and a stale warning after 100 days without a successful run.

---

## Part 3. For Sandra: go live in the app

After Nisha confirms Part 1:

1. In `frontend/aireos/app/services/promoUpliftsApi.js`, set `PROMO_UPLIFTS_DEMO = false`. Delete `frontend/aireos/app/utils/promoUpliftsDemo.js` and the `import * as demo` line.
2. In `frontend/aireos/app/services/scenarioPromotionsApi.js`, set `SCENARIO_PROMOTIONS_DEMO = false` and remove its demo store.
3. Run `npm run lint` in `frontend/aireos` and `pytest` in `backend`.
4. Commit and deploy (`deploy/deploy.sh test`).
5. **Browser checks:**
   - **Promotion Uplift Settings:**
     - 13 mechanics, all Rule-based / Starting value; rule card says 0.4% (5 points deeper → +2%).
     - Each customer's anchor shows its source.
     - Edit a value → it becomes Estimate, and History shows two versions.
     - Reset → back to Rule-based.
     - Archive → hidden unless "Show archived"; Restore brings it back.
     - Add "35% Off" → appears as a rule-based uplift at 35%.
     - Rule card → Edit → type 0.6: the preview shows the new rule-based uplifts; Save → the table moves, Measured/Estimate rows don't. Type 4 → the warning; 20 → rows show "capped at +300%". Reset to default → 0.4.
     - The "Measured from sales data" panel says "Not measured yet" until the first run.
   - **Re-measure:** the toast says how many values were updated; Fairprice rows turn Measured. Pressing it again → "Nothing has changed since the last measurement".
   - **Notes:** type a Fairprice customer uplift for a measured mechanic, then Re-measure → a note appears. Keep mine → it goes away. Use measured → the value turns Measured.
   - **Scenario builder → Promotions:**
     - Pick Fairprice and one SKU → the dropdown shows that SKU's value with "(Measured · n months)" where it has one.
     - Add a side offer and a monthly promotion in the same month → the Simulated line moves by the replace rule.
     - Save and reload → still there.
6. Then do Part 2 (the daily job).

---

## Part 4. Day-to-day: checking, changing settings, troubleshooting

### 4.1 Is it working?

The settings page shows "Last measured … · next run …". Or in Cloud SQL:

```sql
SELECT run_id, status, finished_at, counts->>'applied' AS applied, warnings, error
FROM promo_measurement_runs ORDER BY run_id DESC LIMIT 10;
```

Most days show `skipped_unchanged`; a new month of sales or new promotions gives a `succeeded` run.

### 4.2 Changing a setting (starting weight, minimum exposure, …)

Settings are versioned. Add a new version (copy the current values and change one), in Cloud SQL Studio:

```sql
BEGIN;
UPDATE promo_measurement_config SET superseded_at = now() WHERE superseded_at IS NULL;
INSERT INTO promo_measurement_config
    (starting_weight, min_exposure, reask_points, stale_days, trend_min_months, backtest_tolerance_points, changed_by)
VALUES (3, 0.23, 2, 100, 6, 1, '<your name>');
COMMIT;
```

The next run measures again with the new settings, because they're part of its fingerprint.

### 4.3 Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| Run `failed`, error mentions permission / 403 on BigQuery | `aireos-jobs` lacks BigQuery Job User or Data Viewer | Add the role (2.2) |
| Run `failed`, error mentions the database or login | Not a database user, or missing grants | Part 1.5 |
| Run `failed`: "fc_training_input has no rows" | The pipeline view is empty | Check the forecasting pipeline (Updated Run Order) |
| Warning "fc_backtest_forecasts does not exist yet" | Pipeline change (forecasting.md Part C) not deployed | Not an error: no backtest check until it is |
| `succeeded_with_warnings`: "cannot be read" | A promotion label like "Free gift" | Fix the label on the Promotions page, or accept it isn't measured |
| Re-measure says "already in progress" | The daily run (or another click) is running | Try again in a minute |
| Stale warning on the page | No successful run for 100 days | Check Cloud Run → Jobs → aireos-promo-measure, and the scheduler |
| The scheduler run fails with 403 | `aireos-jobs` can't start the job | 2.3, the `add-iam-policy-binding` step |

---

## Part 5. Later (not now)

**Bell notifications for the measurement job:**
- One small migration that widens the existing `notifications` type check (same pattern as `004_add_mapping_notification_type.sql`) with `promo_uplift_pending` and `promo_measurement_failure`.
- The job writes one per run with `notification_service.insert_best_effort` (never failing the run).
- The notes table stays the source of truth, since notifications are deleted after 60 days.
