# Forecasting: pipeline, backtest forecasts and promotion uplift

**For:** Sandra (forecasting and promotions owner) and the team
**Last updated:** 28 Oct 2026
**Pages this covers:** Forecast, Forecast › Scenario builder, Forecast › Promotion Uplift Settings

This is the one reference for everything forecasting-related in aireOS:

- how the BigQuery forecasting pipeline works;
- the change that keeps every backtest month's forecast;
- how promotion uplift values are set, used and now **measured automatically**;
- the read-only data checks behind those decisions;
- what is built and what is still to do.

The step-by-step instructions for **Nisha (migrations)** and **Google Cloud (the measurement job)** are in a separate runbook: [docs/promo-uplift-runbook.md](promo-uplift-runbook.md).

---

## Contents

- [Part A. Start here](#part-a-start-here)
- [Part B. The forecasting pipeline (BigQuery)](#part-b-the-forecasting-pipeline-bigquery)
- [Part C. Pipeline change: keep every backtest month's forecast](#part-c-pipeline-change-keep-every-backtest-months-forecast)
- [Part D. Promotion uplift: concepts and how the pages use it](#part-d-promotion-uplift-concepts-and-how-the-pages-use-it)
- [Part E. Measuring uplift from sales data](#part-e-measuring-uplift-from-sales-data)
- [Part F. The data checks (what the data showed)](#part-f-the-data-checks-what-the-data-showed)
- [Part G. What is built, and where in the code](#part-g-what-is-built-and-where-in-the-code)
- [Part H. Status, order of work and open items](#part-h-status-order-of-work-and-open-items)
- [Part I. Limitations (for the report)](#part-i-limitations-for-the-report)
- [Part J. Glossary](#part-j-glossary)

---

## Part A. Start here

### A1. Which file goes where

Only `.sql` files are ever pasted into a console, and each one says which console. Markdown files are for reading.

| File | What it is | Where it runs | Who | When |
|---|---|---|---|---|
| Updated Run Order (Claude artifact) | Every BigQuery pipeline object (A1–A13) | BigQuery console | Sandra | Set up once; Part C adds to it |
| Initial Yearly Forecast — Automation & Test Plan (Claude artifact) | Sandbox replay and live deploy of the pipeline | BigQuery console | Sandra | In progress |
| SQL blocks in Part C of this document | Pipeline change (A3, A7, A8, A13) | BigQuery console, sandbox first, then live | Sandra | With the Initial plan's deploy |
| `backend/migrations/checks/promo_measurement_checks_bigquery.sql` (B blocks) | Read-only checks on the forecasting data | BigQuery console | Sandra | Done 28 Oct |
| `backend/migrations/checks/promo_measurement_checks_bigquery_promotions.sql` (C blocks) | Read-only checks on the promotion data | BigQuery console | Sandra | Done 28 Oct |
| `backend/migrations/checks/promo_measurement_checks_cloudsql.sql` | The same C checks against Cloud SQL | Cloud SQL Studio | Nisha | Fallback only |
| `backend/migrations/006_…`, `007_…`, `008_…` | Cloud SQL tables (PostgreSQL) | Cloud SQL Studio, instance `aireos-postgresql`, database `aireos` | Nisha or Sandra only | When the runbook says "ready to run" |
| [docs/promo-uplift-runbook.md](promo-uplift-runbook.md) | Instructions for Nisha and the Google Cloud setup | Read it | Nisha, Sandra | Before go-live |

The migrations are **Cloud SQL (PostgreSQL)**, not BigQuery. The application **never writes to BigQuery**; only the pipeline does.

### A2. The two systems, in one picture

```
BIGQUERY (pipeline; the app only reads it)                CLOUD SQL (the app reads and writes)
  fc_training_input  ── sales history per customer+SKU+month   promotions, stores, sellout (source of truth)
  run_monthly_forecast_pipeline (nightly when a new month)     promo_uplift_settings / promo_anchor_settings (006)
    ├─ holdout models → fc_model_quality_log (+ NEW fc_backtest_forecasts)
    ├─ 13-month forecasts → aire_forecasting_runs → archive   scenario_promotions (007)
    └─ aire_forecasting_output (what the Forecast page reads) promo_measurement_* tables (008)
                    │                                                     ▲
                    └──── read by the measurement job (daily 04:00 SGT) ──┘ writes measured values
```

---

## Part B. The forecasting pipeline (BigQuery)

The full SQL for every object lives in the **Updated Run Order** artifact. This part explains what it does, in order, so the rest of this document makes sense.

### B1. Objects (set up once)

| Step | Object | What it holds |
|---|---|---|
| A1 | `fc_promo_calendar_monthly`, `fc_training_input`, `fc_future_input` (views) | Promotions per customer/SKU/month; training history (Jan 2025 → last complete month) with its `promo_mix`; 13 future months with their promotion input |
| A2 | `fc_data_check_log`, `run_promo_checks`, `run_data_checks` | Data checks (P1–P5, D1–D4, E1, F1–F2); any `fail` stops a retrain |
| A3 | `aire_forecasting_runs`, `aire_forecasting_initial`, `fc_model_quality_log`, `training_run_log` (+ **`fc_backtest_forecasts`**, Part C) | Forecasts of the last two runs; frozen Initial per year; backtest scores; retrain log |
| A4 | `aire_forecasting_archive` | Every run, kept forever |
| A5 | `fc_backtest_input`, `fc_model_quality_views`, `aire_forecasting_output` (views) | Backtest windows (cut-offs 3–6 months back, 3 test months each, ≥ 6 training months); latest score + confidence band; **what the app reads** |
| A6 | `fc_tier0_forecasts`, `run_tier0_legacy` (teammate's) | Tier 0: the P&L spreadsheet formula |
| A7 | `run_post_run_checks` | R1–R6 (+ **R7**, Part C) after every run |
| A8 | `run_monthly_forecast_pipeline` | The pipeline (below) |
| A9 | `retrain_if_new_month` | Runs A2 then A8 when a new, complete month has landed |
| A10 | Schedules S1 (01:00 SGT) and S2 (02:00 SGT) | Daily promotion checks; daily retrain check |
| A11 | 2026 Initial backfill | One-off, by hand |
| A12 | First run | One-off |
| A13 | **Backtest forecasts backfill** (Part C) | Optional, once-off |

### B2. What the pipeline does each time a new month lands (A8)

0. Stops loudly if there's no training data or no backtest window. Step **0d** (new, Part C) makes sure `fc_backtest_forecasts` exists.
1. Trains **Tier 1 basic** (ARIMA_PLUS, no promotion input) and **Tier 1 advanced** (ARIMA_PLUS_XREG, with `promo_mix`).
2. **Backtest:**
   - 2a/2b train **holdout models**: copies of both models trained on data that stops 3, 4, 5 and 6 months early, scored on the 3 months after each cut-off (`ML.EVALUATE`, one average per series and window).
   - **2c (new, Part C)** stores each test month's forecast next to its actual.
3. 13-month forecasts from both Tier 1 models and Tier 0, then the **best line** per series and month (3c):
   - Tier 0 if under 6 months of history, or if Tier 1 is poor (sMAPE > 50) and Tier 0 better;
   - otherwise Tier 1 advanced only when a promotion is entered for that month, its promotion type has been seen 3+ times, and it beats Tier 1 basic on sMAPE;
   - otherwise Tier 1 basic.
4. (Moved to step 7.)
5. Archives the run (5a), then keeps only the last two runs in `aire_forecasting_runs` (5).
6. Post-run checks R1–R7. Any `fail` stops here.
7. **Initial yearly forecast:** once the latest month is November or later and next year's Initial doesn't exist, it's created from this run's best line and frozen (7, 7b, 7c, 7d).

### B3. How the app reads it

- `GET /api/forecast` reads `aire_forecasting_output`: the actual, Initial, Previous and Current lines per customer, SKU and month, and **`current_source_model`** (`tier1_arima`, `tier1_arimax` or `tier0_legacy`).
- **Scenario builder: Official forecast | Plan my own promotions.** In SKU-months whose Current line comes from Tier 1 advanced, the forecast already includes the promotion entered for that month.
  - In **Official** view, planned promotion and voucher uplifts are **not added** there (building blocks still are).
  - **Plan my own promotions** swaps those SKU-months for the forecast the pipeline would have picked without Tier 1 advanced (`GET /api/forecast/alternatives`, same rule as step 3c), so planned promotions are added exactly once. The official line stays as a grey dotted reference.
- The Forecast page, Inventory and Dashboard always use the official forecast. Nothing in the Scenario builder changes it.

### B4. Initial yearly forecast (summary)

Created by data, not the calendar: the first clean run whose latest month is November writes next year's Initial, and nothing later touches it. The sandbox replay and the December checklist are in the **Initial Yearly Forecast — Automation & Test Plan** artifact. Part C's change ships in the same deployment.

---

## Part C. Pipeline change: keep every backtest month's forecast

### C1. What and why

The promotion uplift measurement (Part E) needs a safety check: in **past** months that ran a promotion, did sales come in above or below what a **promotion-blind** forecast expected?

| Candidate | Can it give an honest forecast of a past month? |
|---|---|
| Main models (`tier1_arima_model`) | **No.** They're trained on every month, so they've already seen the answer |
| Archive (`aire_forecasting_archive`) | **Not for past months.** It started 20 Oct 2026 and only holds forecasts of future months; useful in a year |
| **Holdout models** (steps 2a/2b) | **Yes.** They were trained without those months and already exist every run |

Today the holdout models are asked only for an **average** error. New step **2c** asks the **same** models (no new training) for their forecast of **each test month** and stores it, with the actual, in `fc_backtest_forecasts`.

Tier 1 basic (ARIMA_PLUS) has no promotion input, so in a promotion month its error is roughly the promotion's effect.

> Illustrative (the actual is real, the rest made up): in June 2026, Fairprice Adult Pants L sold 679 cartons; a holdout model trained only to March forecast 620. Error = (679 − 620) ÷ 620 = **+9.5%**: more than a promotion-blind forecast expected. If the measured uplift for that month's mechanic came out **negative**, the check would disagree and that value would be held for the run.

**It does not change** any forecast, score, best-line choice or Initial. It only **reads** models steps 2a and 2b already built, and **writes** to its own table.

**Size:** (series with a backtest) × 4 windows × 3 months × 2 models ≈ a few hundred rows per run. Append-only, kept forever.

**Coverage today:** test months run Mar–Aug 2026, Fairprice only (NHG and Sheng Shiong are too short for a backtest, as today).

### C2. Built to run no matter what

| Situation | What happens |
|---|---|
| The table doesn't exist (A3 not rerun, a new dataset, the sandbox) | Step 0d creates it at the start of every run (`IF NOT EXISTS`) |
| A holdout model is missing or `ML.FORECAST` errors | That model's part is skipped, a `warn` row is written, and the pipeline **carries on** |
| One model fails, the other works | Each has its own guard; the working one is stored |
| The same run's step 2c runs twice | Each part deletes its own rows for that run first, so no duplicates |
| A window or series has no test months | Nothing is written for it (the join only keeps months with an actual) |
| Fewer rows stored than expected | **R7** logs a `warn`. It never fails a run, so it can't block a retrain or the Initial |
| No series is old enough for a backtest | The pipeline already stops at 0c (unchanged) |
| The backfill is run at the wrong moment | It checks the models still match the current windows and skips with a message if not |

A `warn` sends no email. The measurement treats missing backtest data as "no check" (nothing is held) and records that in the run.

### C3. The SQL

**C3.1 A3: add as a fifth statement at the end of `A3_tables`**

```sql
-- Every backtest month's forecast next to its actual, every run (append-only).
-- Written by pipeline step 2c; read by the promotion uplift measurement job.
CREATE TABLE IF NOT EXISTS `aire-data.Aire_Data_Analytics.fc_backtest_forecasts` (
  evaluated_at TIMESTAMP,              -- the run (same value as fc_model_quality_log.evaluated_at)
  model_name STRING,                   -- 'tier1_arima' or 'tier1_arimax'
  customer_id INT64,
  sku STRING,
  cutoff_back INT64,                   -- the backtest window (months back from the latest month)
  month_year DATE,                     -- the test month being forecast
  predicted_quantity_cartons FLOAT64,
  prediction_interval_lower_bound FLOAT64,
  prediction_interval_upper_bound FLOAT64,
  actual_quantity_cartons FLOAT64,
  promo_mix STRING                     -- that month's promo_mix, as the backtest saw it
);
```

**C3.2 A8: new step 0d.** Paste right **after step 0c** (the `IF … fc_backtest_input has no test rows … END IF;` block) and before `-- 1a.`:

```sql
  -- 0d. NEW (28 Oct): make sure the backtest month table exists (no-op after the first run)
  CREATE TABLE IF NOT EXISTS `aire-data.Aire_Data_Analytics.fc_backtest_forecasts` (
    evaluated_at TIMESTAMP, model_name STRING, customer_id INT64, sku STRING,
    cutoff_back INT64, month_year DATE, predicted_quantity_cartons FLOAT64,
    prediction_interval_lower_bound FLOAT64, prediction_interval_upper_bound FLOAT64,
    actual_quantity_cartons FLOAT64, promo_mix STRING);
```

**C3.3 A8: new step 2c.** Paste right **after the INSERT that ends step 2b** (ending `FROM ev JOIN tw USING (customer_id, sku, cutoff_back);` under `-- 2b.`) and before `-- 3a. ARIMA_PLUS forecast, 13 months`:

```sql
  -- 2c. NEW (28 Oct): keep every backtest month's forecast next to its actual (read by the
  --     promotion uplift measurement). Only reads the holdout models from 2a/2b. Each model
  --     is guarded separately and never stops the pipeline: an error becomes a 'warn' row.
  BEGIN
    DELETE FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
    WHERE evaluated_at = run_ts AND model_name = 'tier1_arima';

    INSERT INTO `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
      (evaluated_at, model_name, customer_id, sku, cutoff_back, month_year,
       predicted_quantity_cartons, prediction_interval_lower_bound, prediction_interval_upper_bound,
       actual_quantity_cartons, promo_mix)
    SELECT run_ts, 'tier1_arima', f.customer_id, f.sku, f.cutoff_back, t.month_year,
           f.forecast_value, f.prediction_interval_lower_bound, f.prediction_interval_upper_bound,
           t.quantity_cartons, t.promo_mix
    FROM ML.FORECAST(MODEL `aire-data.Aire_Data_Analytics.tier1_arima_model_holdout`,
      STRUCT(3 AS horizon, 0.8 AS confidence_level)) AS f
    JOIN `aire-data.Aire_Data_Analytics.fc_backtest_input` AS t
      ON t.is_test
     AND t.customer_id = f.customer_id AND t.sku = f.sku AND t.cutoff_back = f.cutoff_back
     AND t.month_year = CAST(f.forecast_timestamp AS DATE);
  EXCEPTION WHEN ERROR THEN
    INSERT INTO `aire-data.Aire_Data_Analytics.fc_data_check_log` (checked_at, check_name, status, detail)
    VALUES (CURRENT_TIMESTAMP(), 'B1_backtest_forecasts_arima', 'warn',
            CONCAT('Step 2c (ARIMA_PLUS) failed, pipeline continued: ', @@error.message));
  END;

  BEGIN
    DELETE FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
    WHERE evaluated_at = run_ts AND model_name = 'tier1_arimax';

    INSERT INTO `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
      (evaluated_at, model_name, customer_id, sku, cutoff_back, month_year,
       predicted_quantity_cartons, prediction_interval_lower_bound, prediction_interval_upper_bound,
       actual_quantity_cartons, promo_mix)
    SELECT run_ts, 'tier1_arimax', f.customer_id, f.sku, f.cutoff_back, t.month_year,
           f.forecast_value, f.prediction_interval_lower_bound, f.prediction_interval_upper_bound,
           t.quantity_cartons, t.promo_mix
    FROM ML.FORECAST(MODEL `aire-data.Aire_Data_Analytics.tier1_arimax_model_holdout`,
      STRUCT(3 AS horizon, 0.8 AS confidence_level),
      (SELECT customer_id, sku, cutoff_back, month_year, promo_mix
       FROM `aire-data.Aire_Data_Analytics.fc_backtest_input` WHERE is_test)) AS f
    JOIN `aire-data.Aire_Data_Analytics.fc_backtest_input` AS t
      ON t.is_test
     AND t.customer_id = f.customer_id AND t.sku = f.sku AND t.cutoff_back = f.cutoff_back
     AND t.month_year = CAST(f.forecast_timestamp AS DATE);
  EXCEPTION WHEN ERROR THEN
    INSERT INTO `aire-data.Aire_Data_Analytics.fc_data_check_log` (checked_at, check_name, status, detail)
    VALUES (CURRENT_TIMESTAMP(), 'B2_backtest_forecasts_arimax', 'warn',
            CONCAT('Step 2c (ARIMA_PLUS_XREG) failed, pipeline continued: ', @@error.message));
  END;
```

Tier 0 is left out on purpose: its procedure is the teammate's, and the check needs a promotion-blind model. ARIMA_PLUS_XREG is kept because it costs nothing and helps later accuracy work.

**C3.4 A7: post-run check R7.** In `run_post_run_checks`, the big INSERT ends with `FROM init i;`. Replace that line with:

```sql
  FROM init i
  UNION ALL
  SELECT ts, 'R7_backtest_forecasts_stored',
         IF(IFNULL((SELECT COUNT(*) FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
                    WHERE evaluated_at = run_ts AND model_name = 'tier1_arima'), 0)
            = (SELECT COUNTIF(is_test) FROM `aire-data.Aire_Data_Analytics.fc_backtest_input`),
            'pass', 'warn'),
         FORMAT('%d ARIMA_PLUS backtest month forecasts stored, %d expected',
                IFNULL((SELECT COUNT(*) FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
                        WHERE evaluated_at = run_ts AND model_name = 'tier1_arima'), 0),
                (SELECT COUNTIF(is_test) FROM `aire-data.Aire_Data_Analytics.fc_backtest_input`));
```

R7 is a **warn**, never a fail. The table always exists by the time A7 runs, because step 0d creates it.

**C3.5 A13: one-off backfill (optional).** This fills the table from the holdout models of the **last completed live run**, so there's check data before the next monthly run. It's safe any time and rerunnable:

- it uses the run whose scores are newest in `fc_model_quality_log`, which is the run that built the current holdout models;
- it **skips** with a message if a new month has arrived since (the windows would no longer match the models);
- it deletes that run's rows first.

Paste the whole block and Run it as one script:

```sql
DECLARE run_ts TIMESTAMP DEFAULT (
  SELECT MAX(evaluated_at) FROM `aire-data.Aire_Data_Analytics.fc_model_quality_log`
  WHERE model_name = 'tier1_arima');
DECLARE last_trained DATE DEFAULT (
  SELECT MAX(latest_month_seen) FROM `aire-data.Aire_Data_Analytics.training_run_log` WHERE retrained);
DECLARE latest_month DATE DEFAULT (
  SELECT MAX(month_year) FROM `aire-data.Aire_Data_Analytics.fc_training_input`);

CREATE TABLE IF NOT EXISTS `aire-data.Aire_Data_Analytics.fc_backtest_forecasts` (
  evaluated_at TIMESTAMP, model_name STRING, customer_id INT64, sku STRING,
  cutoff_back INT64, month_year DATE, predicted_quantity_cartons FLOAT64,
  prediction_interval_lower_bound FLOAT64, prediction_interval_upper_bound FLOAT64,
  actual_quantity_cartons FLOAT64, promo_mix STRING);

IF run_ts IS NULL THEN
  SELECT 'Skipped: no pipeline run has scored ARIMA_PLUS yet.' AS result;
ELSEIF last_trained IS NULL OR latest_month != last_trained THEN
  SELECT FORMAT('Skipped: training data now ends %t but the last retrain used data to %t, so the backtest windows no longer match the models. The next pipeline run fills the table itself.',
                latest_month, last_trained) AS result;
ELSE
  DELETE FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts` WHERE evaluated_at = run_ts;

  INSERT INTO `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
    (evaluated_at, model_name, customer_id, sku, cutoff_back, month_year,
     predicted_quantity_cartons, prediction_interval_lower_bound, prediction_interval_upper_bound,
     actual_quantity_cartons, promo_mix)
  SELECT run_ts, 'tier1_arima', f.customer_id, f.sku, f.cutoff_back, t.month_year,
         f.forecast_value, f.prediction_interval_lower_bound, f.prediction_interval_upper_bound,
         t.quantity_cartons, t.promo_mix
  FROM ML.FORECAST(MODEL `aire-data.Aire_Data_Analytics.tier1_arima_model_holdout`,
    STRUCT(3 AS horizon, 0.8 AS confidence_level)) AS f
  JOIN `aire-data.Aire_Data_Analytics.fc_backtest_input` AS t
    ON t.is_test
   AND t.customer_id = f.customer_id AND t.sku = f.sku AND t.cutoff_back = f.cutoff_back
   AND t.month_year = CAST(f.forecast_timestamp AS DATE);

  INSERT INTO `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
    (evaluated_at, model_name, customer_id, sku, cutoff_back, month_year,
     predicted_quantity_cartons, prediction_interval_lower_bound, prediction_interval_upper_bound,
     actual_quantity_cartons, promo_mix)
  SELECT run_ts, 'tier1_arimax', f.customer_id, f.sku, f.cutoff_back, t.month_year,
         f.forecast_value, f.prediction_interval_lower_bound, f.prediction_interval_upper_bound,
         t.quantity_cartons, t.promo_mix
  FROM ML.FORECAST(MODEL `aire-data.Aire_Data_Analytics.tier1_arimax_model_holdout`,
    STRUCT(3 AS horizon, 0.8 AS confidence_level),
    (SELECT customer_id, sku, cutoff_back, month_year, promo_mix
     FROM `aire-data.Aire_Data_Analytics.fc_backtest_input` WHERE is_test)) AS f
  JOIN `aire-data.Aire_Data_Analytics.fc_backtest_input` AS t
    ON t.is_test
   AND t.customer_id = f.customer_id AND t.sku = f.sku AND t.cutoff_back = f.cutoff_back
   AND t.month_year = CAST(f.forecast_timestamp AS DATE);

  SELECT FORMAT('Backfilled run %t.', run_ts) AS result;
END IF;
```

If the XREG part errors, the ARIMA_PLUS rows are still in place (the measurement only needs those), and the next pipeline run fills both.

### C4. Rolling it out with the Initial Yearly Forecast plan

The 27 Oct A8 isn't on live yet, so ship this in the same deployment: **one new A8, one sandbox replay, one live deploy.**

| Initial plan step | What changes |
|---|---|
| Build `sim/sim_deploy.sql` | Use the updated A3, A7 and A8; the find-and-replace renames the new table to `_sim` like everything else |
| Sanity checks | `fc_backtest_forecasts` must appear only as `Aire_Data_Analytics_sim.fc_backtest_forecasts` |
| `SIM_status` | Add query V4 (below); in Stages 1–3 expect R7 `pass`, no `B1_`/`B2_` rows, and V4 two rows with equal counts; in Stage 4 V4 is unchanged |
| Reset block | Add ``TRUNCATE TABLE `aire-data.Aire_Data_Analytics_sim.fc_backtest_forecasts`;`` |
| Troubleshooting | A `B1_`/`B2_` warn row means step 2c couldn't read a holdout model (the `detail` says why). Not blocking: the Initial is unaffected. Fix before going live; R7 will also warn |
| Live deploy | Back up **A7 too** (`A7_backup_before_28Oct`, the same `INFORMATION_SCHEMA.ROUTINES` query with `routine_name = 'run_post_run_checks'`), then run A3, A7, A8; check `last_altered` on both procedures |
| After the next real run | R1–R7 `pass`, no I1/I2 rows, no `B1_`/`B2_` rows |
| Optional | Run A13 on live and check L1 (below) |
| Repo/PR | A3 and A7 changed too |

### C5. Checks

```sql
-- V4 (sandbox SIM_status): backtest month forecasts for the latest run (expect both models, same counts)
SELECT model_name, COUNT(*) AS rows_, COUNT(DISTINCT FORMAT('%t|%t', customer_id, sku)) AS series,
       MIN(month_year) AS first_test_month, MAX(month_year) AS last_test_month
FROM `aire-data.Aire_Data_Analytics_sim.fc_backtest_forecasts`
WHERE evaluated_at = (SELECT MAX(evaluated_at) FROM `aire-data.Aire_Data_Analytics_sim.fc_backtest_forecasts`)
GROUP BY model_name;

-- L1 (live): what's stored, per run and model
SELECT evaluated_at, model_name, COUNT(*) AS rows_,
       MIN(month_year) AS first_test_month, MAX(month_year) AS last_test_month
FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
GROUP BY evaluated_at, model_name
ORDER BY evaluated_at DESC, model_name;

-- L2 (live): relative error per month, ARIMA_PLUS, latest run
SELECT customer_id, sku, month_year, cutoff_back, promo_mix,
       ROUND(predicted_quantity_cartons) AS forecast, actual_quantity_cartons AS actual,
       ROUND(100 * SAFE_DIVIDE(actual_quantity_cartons - predicted_quantity_cartons,
                               predicted_quantity_cartons), 1) AS rel_error_pct
FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`
WHERE model_name = 'tier1_arima'
  AND evaluated_at = (SELECT MAX(evaluated_at) FROM `aire-data.Aire_Data_Analytics.fc_backtest_forecasts`)
ORDER BY customer_id, sku, month_year, cutoff_back;
```

**Rollback:** run `A7_backup_before_28Oct` and the latest A8 backup. The table can stay; only the measurement reads it, and it treats an empty table as "no check".

---

## Part D. Promotion uplift: concepts and how the pages use it

### D1. What uplift is

Every month in the training data had some promotion, so the forecast describes an **ordinary month**, with the customer's usual promotion already inside it. **Uplift** is how much more (or less) a month with a particular promotion sells than that ordinary month.

> Fairprice's ordinary month is about 25% off. "30% Off" at +2% on a Current forecast of 2,000 cartons adds 2,000 × 2% = 40. With a voucher (+3%): 2,000 × 5% = 100.

### D2. Where the uplifts come from (in order of precedence)

1. **Scope.** The most specific current uplift wins: **SKU → product range → customer → all customers**.
2. **Source:**

| Source | Where it comes from | Changes when |
|---|---|---|
| **Rule-based** | The rule (D3), all-customers only | The rule's rate or the customer's anchor changes |
| **Measured** | The measurement job (Part E), per customer and per SKU | The job finds new evidence (daily check) |
| **Estimate** | Typed by a person on the settings page | Only when a person changes it. **Never overwritten by the job** |
| **Learned** | Reserved for a future model-learned value | (not used yet) |

Archived uplifts are kept (history) but never offered or measured.

### D3. The rule, the anchor and the chain of uplifts

**The chain, in plain words.** Every promotion uplift the Scenario builder uses comes from one chain:

> **rule-based uplift → blended customer uplift → blended SKU uplift**

- The **rule-based uplift** is a simple starting assumption for every customer.
- Once a customer has evidence, its **blended customer uplift** mixes the customer's own uplift (from its sales) with the rule-based uplift.
- Once a SKU has evidence, its **blended SKU uplift** mixes the SKU's own uplift with the blended customer uplift.

Each level **leans on the level above while its own evidence is thin**, and stands more on its own as evidence grows (Part E, Step 4). Without evidence, a level is simply the level above.

**The rule (updated 28 Oct: editable).**

> rule-based uplift = (promotion's effective discount − customer's anchor) × **+0.4% per point**, to a whole percent, rounded half away from zero, kept within −90…+300; the voucher stays fixed at +3

- In words: **+0.4% sales for every extra percentage point of discount deeper than normal**. For example, **5 points deeper → +2%**; 5 points shallower → −2%.
- It is a **deliberately small, conservative starting assumption, not derived from Aire's data**. It only has to be reasonable until measured uplifts take over.
- It is **editable on the settings page as one rate** (the "Rule for rule-based uplifts" card). It's versioned, with History and Reset to default (0.4).
  - There's no upper limit. Above 1.0 the dialog warns ("much higher than the default"), but saving still works.
  - Every rule-based uplift is **capped at −90…+300%** wherever it's worked out (the table and preview say "capped at +300%"), so a large rate can never break a save.
  - The rate only shapes **planning**: rule-based uplifts in the Scenario builder, and the starting point of measured uplifts. It **never changes the official forecast**.
- A rate change moves rule-based uplifts only: **not measured or estimate uplifts, and not saved Scenario builder promotions** (they keep their copied uplift; the "Settings now say … · Update" notice offers the new one). It does trigger a re-measure, because the rate is part of the measurement's fingerprint.

> At the default 0.4, Fairprice's anchor 25%: 30% Off → (30 − 25) × 0.4 = **+2%**; 50% Off → **+10%**; 15% Off → **−4%**. At 0.6: 30% Off → **+3%**.

**Effective discount:**
- `pct_off_X` and `bN_pct_off_X` → X
- Buy N Get M Free → M ÷ (N + M), so B1G1 = 50 and B2G1 = 33.3

**The anchor** is a customer's ordinary-month discount. In use: **typed by hand → suggested from data → the all-customers value → 20%**.

**How the suggestion is worked out** (updated 28 Oct):
- For every store and day, the discount running: a monthly promotion sets it, a side offer, bundle or other promotion **replaces** it on its days, and the deepest of the same kind wins. Voucher-only days are skipped.
- Each month's figure is the average over store-days with a discount, **each store weighted by its share of the customer's sales**, so a promotion in a few small stores barely counts.
- The suggestion is the median of the 24 months **before the current month**, rounded. Planned future promotions are ignored.

Only rule-based uplifts follow the anchor and the rule, plus measured uplifts with little evidence, slightly, through their starting point (E2, Step 4).

### D4. How the Scenario builder uses an uplift

> effective uplift = (override, or the reference value) + (voucher value, if Yes)
>
> extra units = Current units × effective uplift × share of the month

- **Share of the month:**
  - 1 for whole-month types;
  - for a side offer, days covered ÷ days in the month;
  - for a **monthly** promotion, whatever share a switched-on side offer, bundle or other promotion of the same customer and product doesn't replace (updated 28 Oct).

  > Monthly +2% all month with a +4% side offer on 10 of 30 days: 2 × 20/30 + 4 × 10/30 = **+2.7%** (before 28 Oct the two were added: +3.3%).

- Each item is worked out from the same Current forecast, and the results are **added**, not multiplied.
- **The reference value is copied when chosen.** A saved promotion keeps it, and a "Settings now say … · Update" notice offers the new one.
- **With one SKU picked**, the dropdown, source tag, lookup popover and default mechanic use **that SKU's own uplift and source** (e.g. "30% Off · +6% (Measured · 7.4 months)"). The default mechanic is the one nearest 0%.
- In Official view, months forecast by Tier 1 advanced get no promotion uplift (B3).

### D5. The Promotion uplift settings page

| Section | What it does |
|---|---|
| Intro | One line on what uplift is for, and a collapsed "How this page works" (five short points) |
| **Measured from sales data** (new) | Last measured / next run (daily 04:00 SGT); stale warning after 100 days without a successful run; last-run failure message; **Re-measure**; open **notes** ("Measured uplift is now X (n months). Your uplift Y. [Use measured] [Keep mine]"), and the same for typed anchors ([Use suggested] / [Keep mine]) |
| Ordinary-month discount by customer | Each customer's anchor, its source and suggestion; edit (with a before/after preview of the rule-based uplifts), reset, history |
| **Rule for rule-based uplifts** (new) | "Assume sales rise **0.4**% for every extra percentage point of discount deeper than the customer's normal discount", with "For example, 5 points deeper than normal → +2%"; Edit (one rate, a live before/after preview at the anchor the page is showing, a warning above 1.0), History, Reset to default |
| Unmapped mechanics | Labels in the promotions data that match no uplift |
| Uplift by mechanic | Filter by customer and SKU; source tags (Rule-based / Measured / Estimate / Learned / Archived); "capped at +300%" under a capped rule-based uplift; months of evidence under Measured; the row menu has Edit, History, **Evidence** (the measurement behind a customer or SKU uplift), Reset to the rule, Archive / Restore; Add promotion or voucher |

All writes are new versions; nothing is deleted. Edits are recorded as `aireos` until there are user logins; the job records as `measurement`.

**Hover hints ("i") and a tidy layout.** Explanations live in "i" bubbles and the collapsed "How this page works", not in paragraphs on the page. Short explanations sit next to the terms that need them:
- **Settings page:**
  - the section headings (ordinary-month discount, the rule, including why it is one rate for all customers, measured uplifts, notes, uplift by mechanic, unmatched mechanics);
  - the Discount, Uplift, Source and "Suggested from data" columns;
  - the rule dialog's rate;
  - every row of the Evidence dialog.
- **Scenario builder:** the Official / Plan my own promotions note (one line, full reason in the "i"); on the Promotions tab, the "Rule-based uplifts" tag, Mechanic, Voucher, and Mechanic uplift (the override and "the forecast already reflects an ordinary month").

All the texts are in `frontend/aireos/app/utils/promoUpliftHints.js`, so they're worded the same everywhere and easy to edit.

---

## Part E. Measuring uplift from sales data

### E1. The goal

Replace rule-based uplifts with uplifts **measured from Aire's own sales**, recalculated **automatically and indefinitely**, with nobody maintaining them after handover.

### E2. How one uplift is measured

For each customer + SKU + mechanic (and the voucher), over the months in `fc_training_input` (the **window**, the same months the forecast model learns from):

**Step 1: compare each month with the SKU's trend.** A straight line through the SKU's monthly sales (needs ≥ 6 months; otherwise the flat average, `method = flat`). Each month's ratio = actual ÷ trend, and each month's lift = ratio ÷ average ratio − 1.

> Check (a): 12 months growing +20 a month from 1,000, months 9–12 at 30% Off with no real effect. Flat-average method: 1,190 ÷ 1,110 − 1 = **+7.2%** (wrong). Trend method: every ratio is 1 → **0%** (right).

**Step 2: exposure: how much of the month each mechanic counts for.**

> exposure = Σ over stores and days running it (store's share of the SKU's sales ÷ days in the month) ÷ the customer's **usual reach**, capped at 1

- **Usual reach** is the median total discount exposure of the customer's promotion months. Fairprice ≈ 0.67, because every promotion so far is offline and offline is ~65% of sales. Stored uplifts therefore mean "**run the way this customer usually runs promotions**", which is what the Scenario builder plans.
- Store-by-store, a side offer replaces the monthly promotion on its days, and voucher-only days are skipped.
- **Minimum exposure 0.23** (= 7 of 30 days at usual reach): below it, a mechanic isn't evidence for that month. Dividing a month's change by 0.05 would multiply its noise by 20.

  > A 20% Off in a handful of stores reaching 0.034 of sales: 0.034 ÷ 0.67 = 0.05 → not evidence.

- **Contrast rule:** a mechanic only counts for a SKU if the SKU has months **with and without** it. Otherwise its effect can't be told apart from an ordinary month.

**Step 3: share each month's lift between the mechanics that ran.** A small least-squares fit: month lift ≈ Σ (exposure × uplift). It splits a month fairly when two mechanics overlap, and stores full-month equivalents. The voucher is one more term, so the mechanic running alongside it is accounted for ("matched on the same mechanic").

> Check (b): a side offer on 10 of 30 days, month 5% above an ordinary month → 0.05 ÷ (10/30) = **+15%** stored. The Scenario builder then adds 2,000 × 15% × 10/30 = **100 cartons**.
>
> Two mechanics that always run together, each on half the month, month +2% → they share it: **+2% each**.
>
> Sheng Shiong (1 month, one mechanic): no contrast → no evidence → stays rule-based.

**Step 4: blend (shrinkage), starting weight k = 3.** The chain from D3: each level leans on the level above while its evidence is thin.

> blended customer uplift = (N × customer's own uplift + k × rule-based uplift) ÷ (N + k)
>
> blended SKU uplift = (n × SKU's own uplift + k × blended customer uplift) ÷ (n + k)

- N = distinct months with evidence for the customer; n = the SKU's summed exposure.
- The **starting weight (k = 3)** is how many months of evidence the level above counts as.
- The customer's own uplift is the SKUs' own uplifts weighted by sales volume. **No borrowing between customers.**

> First 50% Off month: customer's own uplift +30%, rule-based +10%: (1 × 30 + 3 × 10) ÷ 4 = **+15%**. After 9 months: (9 × 30 + 3 × 10) ÷ 12 = +25%.
>
> SKU's own uplift +40%, blended customer uplift +14%: n = 2 → **+24.4%**; n = 10 → **+34.0%**; n = 0 → **+14%**.

**Step 5: backtest check.**
- From `fc_backtest_forecasts` (Part C), ARIMA_PLUS, latest run: relative error = (actual − forecast) ÷ forecast, exposure-weighted over the backtest months where the mechanic counts.
- If it points the **opposite way** from the blended uplift, **both by ≥ 1 point**, that uplift **keeps its previous uplift** this run (`held_backtest`). Smaller differences count as agreeing.
- No backtest data → "no check", nothing held.

### E3. How values are written

| Situation | What the job does |
|---|---|
| Evidence, no uplift at that scope yet | Inserts a **Measured** customer or SKU uplift (`changed_by = measurement`, months of evidence stored) |
| Evidence, already Measured, same value (to 0.1) | Nothing (`unchanged`) |
| Evidence, already Measured, new value | Supersedes it with a new Measured version |
| Backtest disagrees | Keeps the previous value (`held_backtest`) |
| No evidence | Nothing (`no_evidence`); the value stays as it is |
| A person typed a value at that scope (Estimate) | **Never overwritten.** A note: "[Use measured] / [Keep mine]". Re-asked after Keep mine only if the measured value moves ≥ 2 points, or the typed value changes |
| A person typed a customer or range uplift above a SKU | No SKU uplift is written underneath it (`estimate_pending`) |
| An all-customers Estimate | Used as the starting point instead of the rule; measured customer uplifts still apply |
| A readable mechanic with no settings row (e.g. "35% Off") | Created automatically as an all-customers rule-based uplift, discount from its name |
| An unreadable label | Listed as a warning (run status `succeeded_with_warnings`) and logged at ERROR level |
| A typed anchor that differs from the suggestion | An anchor note: [Use suggested] / [Keep mine] |
| A note whose typed value no longer exists | Closed automatically |
| Archived or learned value | Skipped |
| Out-of-range result | Kept within −90…300 and warned |

**Safety:**
- **One transaction:** a failure changes nothing and is recorded as a `failed` run.
- **One run at a time** (a Postgres advisory lock).
- **The same inputs never write twice:** a fingerprint of every input; unchanged inputs record a `skipped_unchanged` run and stop.
- **Append-only:** nothing is updated in place except `superseded_at`; nothing is deleted.

### E4. How it runs

| | |
|---|---|
| Schedule | Cloud Run Job `aireos-promo-measure`, started by Cloud Scheduler **daily 04:00 SGT** (2 hours after the 02:00 retrain) |
| Account | `aireos-jobs@aire-data.iam.gserviceaccount.com` (its own, not the website's) |
| On demand | **Re-measure** on the settings page (signed-in API, `POST /api/settings/promo-uplifts/measure`) |
| Settings | `promo_measurement_config`: starting weight (k) 3, minimum exposure 0.23, re-ask 2 points, stale after 100 days, trend from 6 months, backtest tolerance 1 point. Versioned; change by inserting a new version (runbook) |
| Failure alerts | Set up separately with teammates (not part of this build). The job exits with an error and logs at ERROR, so any Cloud Monitoring alert on the job will catch it |
| Bell notifications | Not in this version; how to add them later is in the runbook |

### E5. Why these choices

| Choice | Reason |
|---|---|
| Trend, not flat average | Growing SKUs would otherwise look promotion-driven (check a) |
| Usual reach, not "whole customer" | Fairprice never promotes online; storing whole-customer values would over-forecast planned promotions by about 1.5× |
| Minimum exposure 0.23 | Tiny-reach promotions would multiply noise |
| Contrast rule | A mechanic in every month always measures 0%, which isn't evidence |
| Least-squares sharing | One month's change is split fairly between overlapping mechanics |
| Rule-based uplift as the starting point | One early month shouldn't decide a customer's uplift |
| No borrowing between customers | Customers run very different promotion mixes |
| Backtest hold, with a 1-point tolerance | Catches seasonality or fluke months without freezing values over noise |
| Estimates never overwritten | A person's judgement stays theirs; the note keeps it visible |
| Daily, but skip when unchanged | The window always matches the model; "stale" means the job is broken, not that data didn't change |

---

## Part F. The data checks (what the data showed)

Run 28 Oct 2026, read-only, in BigQuery. **B blocks** check the forecasting data, **C blocks** the promotion data (on the Datastream copies of Cloud SQL, minutes behind). Files: `backend/migrations/checks/`.

### F1. How to run a check file

1. BigQuery → project **aire-data** → new query tab.
2. Copy **one block** (from its `-- B…` / `-- C…` heading to its `;`), paste, **Run**.
3. **Save results → CSV**, named after the block. A screenshot is fine for small results.
4. An error is an answer too: copy it exactly and carry on.

The Cloud SQL C file is a fallback for Nisha (Cloud SQL Studio, instance `aireos-postgresql`, database `aireos`) if the BigQuery copies are ever missing.

### F2. Results

| Block | Result | Meaning |
|---|---|---|
| B1a | Window **2025-01-01 to 2026-08-01**; 171 rows, **24 series**; no duplicates or blanks | Clean |
| B1b | **Fairprice:** 9 SKUs, 12–20 months. **NHG:** 9 SKUs, 3 months. **Sheng Shiong:** 6 SKUs, 1 month | Only Fairprice has enough history |
| B2a/b | Archive: 1 run (21 Oct), forecasting Nov 2026 onward | Can't check past months → Part C |
| B3a–c | `fc_backtest_input` holds actuals with train/test flags; `fc_model_quality_log` one average per series and window | Month-level backtest forecasts weren't kept → Part C |
| B4a/b/c | Keys match the catalogue; no duplicate product names; Fairprice → retailers 55, 57; NHG → 456; Sheng Shiong → 460, 461 | Clean |
| C0 | All 17 label/type combinations are readable ("25%" = "25% Off") | Clean |
| C1 | Only Fairprice has promotions in the window; every SKU that ran a mechanic has contrast; the 7-day rule dropped 3 side-offer SKU-months | Fairprice is measurable |
| C2 | Fairprice 15 months with a voucher, 5 without (customer level); NHG and Sheng Shiong none | Voucher measurable but thin |
| C3 | All 59 Fairprice promotions are **offline only**; store share avg 0.86, min 0.02 | → usual-reach rule |
| C4 | No broken links; **6 future promotions** (to 31 Dec 2026) | → anchor uses past months only |
| C5 | NHG and Sheng Shiong have sales but no promotions | They stay rule-based |
| C6a | Fairprice ~65% offline / ~35% online; NHG offline only; Sheng Shiong 93% offline | Online is big but never promoted |
| C6b | Store-wide offline promotions reach 0.63–0.68 of sales; some reach 0.03–0.14 | → minimum exposure |
| Voucher trace | The 8 "Voucher"-mechanic promotions are on Ultra SKUs before those SKUs had sales | Voucher evidence is per SKU |

---

## Part G. What is built, and where in the code

All uncommitted on branch `feat/AO5-18&19-promotion-uplift-settings`.

### G1. Database (Cloud SQL migrations, not yet run)

| File | Creates / changes |
|---|---|
| `006_create_promo_uplift_settings.sql` | `promo_uplift_settings` (sources `rule_based`/`measured`/`estimate`/`learned`, + `kind`, `archived_at`; `evidence_months` NUMERIC(6,2)), `promo_anchor_settings`, **`promo_rule_settings`** (the rate, default 0.4), 15 starting rows |
| `007_create_scenario_promotions.sql` | `scenario_promotions` (dropped `reference_by_sku`/`voucher_by_sku`; check on `reference_source` incl. `rule_based`) |
| `008_create_promo_measurement.sql` | `promo_measurement_config` (`starting_weight`), `promo_measurement_runs`, `promo_measurement_results` (`sku_own_pct`, `customer_own_pct`, `rule_based_pct`, `blended_customer_pct`, `starting_weight`, `blended_pct`), `promo_uplift_pending_notes` |

### G2. Backend

| File | What changed |
|---|---|
| `services/settings/promo_uplift_rules.py` | `effective_discount`, `label_for_key`; `active_by_store_day` (shared store-day rule); `monthly_discounts` with store weights and a `before` date; **`rule_based_uplift(discount, anchor, rate)`** (default 0.4, capped −90…+300) and `rule_based_uplift_capped` |
| `services/settings/promo_measurement_rules.py` (new) | Pure maths: store weights, exposure, usual reach, trend, least-squares fit, shrinkage, backtest check, fingerprint |
| `services/settings/promo_measurement.py` (new) | The job: reads, fingerprint, lock, measure, writes, notes, status, evidence, Use measured / Keep mine |
| `services/settings/promo_uplifts.py` | Store-weighted, past-only anchor; archived rows excluded; active-first SKU lookup; `product_sources`; archive, restore, add mechanic; **the rule**: `get_rule`, `set_rule` (warning above 1.0), `reset_rule`, used by the resolver, reset and add mechanic; `follows_rule` and `capped` on each uplift |
| `schemas/settings/promo_uplifts.py` | `PromoMechanicCreate` (unreadable label → 422), `PromoUpliftArchive`, `PromoNoteDecision` |
| `routers/settings/promo_uplifts.py` | `POST /measure`, `GET /measure/status`, `GET /notes`, `POST /notes/{id}/use-measured`, `POST /notes/{id}/keep-mine`, `POST /mechanics`, `POST /{id}/archive`, `POST /{id}/restore`, `GET /{id}/evidence`, **`GET /rule`, `PUT /rule`, `POST /rule/reset`** (rate ≤ 0 → 422) |
| `scripts/measure_promo_uplifts.py` (new) | The Cloud Run Job entry point |
| `services|schemas/scenario/promotions.py` | Per-SKU JSON fields removed |
| Tests | `test_promo_measurement_rules.py` (new), `test_promo_measurement_service.py` (new), additions to the settings service and router tests; scenario tests updated. **Full suite: 1,373 passed, 15 skipped** |

### G3. Frontend

| File | What changed |
|---|---|
| `services/settingsApi.js`, `services/promoUpliftsApi.js` | Measurement, notes, evidence wrappers |
| `utils/promoUpliftsDemo.js` | Same functions for demo mode (a made-up Fairprice result); per-SKU uplifts keyed by product name; the rule's rate with History and Reset |
| `utils/promoUpliftSettings.js` | Evidence, status and note display helpers |
| `hooks/usePromoMeasurement.js` (new) | Status + open notes |
| `components/settings/PromoMeasurementPanel.jsx` (new), `PromoEvidenceDialog.jsx` (new) | Re-measure, status, stale warning, notes; evidence dialog |
| `components/settings/PromoUpliftTable.jsx`, `PromoUpliftSettingsView.jsx` | Evidence action, months of evidence, the panel |
| `utils/scenarioPromotions.js` | `upliftsForProduct`, SKU-aware options/default, `sourceText`, **side offer replaces monthly** (`monthlyShare`), payload without per-SKU maps |
| `components/settings/PromoRuleCard.jsx`, `PromoRuleDialog.jsx`, `RulePreviewTable.jsx` (new) | The rule card (rate + "5 points deeper → +2%"), its edit dialog (live preview at the page's anchor, warning above 1.0), History (rule kind in `PromoHistoryDialog`), Reset to default; the shared before/after preview with "capped at +300%" |
| `components/scenario/PromotionEditor.jsx`, `MechanicLookupPopover.jsx` | SKU's own values and sources with months of evidence |

`npm run lint`: only 3 errors remain, all in files this branch doesn't touch (`DateRangePicker.jsx`, `promotions/page.js`).

---

## Part H. Status, order of work and open items

| # | Work | Who | Status |
|---|---|---|---|
| 1 | Data checks (B, C) | Sandra | ✅ Done 28 Oct |
| 2 | Backend + frontend build, with tests | Dev | ✅ Done 28 Oct (uncommitted) |
| 3 | Pipeline change (Part C) via the artifact prompt; sandbox; live with the 27 Oct A8; optional A13 | Sandra | To do |
| 4 | Review and commit the branch | Sandra | To do |
| 5 | Send 006 → 007 → 008 + grants to Nisha ([runbook](promo-uplift-runbook.md), Part 1) | Sandra → Nisha | To do |
| 6 | Demo flags off, browser checks (runbook Part 3) | Sandra | After 5 |
| 7 | Deploy the API (new endpoints) and the job; Cloud Scheduler (runbook Part 2) | Sandra | After 5 |
| 8 | First run, check the page | Sandra | After 7 |
| 9 | Failure alerting | Sandra + teammates | Separately |

Open items:
- Failure alert recipients (to be set up with teammates).
- Bell notifications (later).
- Update the Promotions Uplift design doc §6.5, §6.6, §7.1–7.7 to match Parts D–E.

---

## Part I. Limitations (for the report)

- **Only Fairprice is measured today.** NHG (3 months) and Sheng Shiong (1 month) have no promotions or contrast; they stay rule-based until they do.
- **Trend absorbs part of an effect.** With little history, or when promotions cluster at one end, the trend line and the average month absorb some of a lift. A test with 8 months shows a true +15% side offer measured at about +12%.
- **Usual reach is per customer, not per SKU or channel.** A future online promotion would be measured relative to offline reach.
- **Voucher evidence is thin** (per SKU), so the voucher stays close to +3% for now.
- **Additive stacking** of several large uplifts can overstate their combined effect.
- **The backtest window is recent** (about 6 months), so many mechanics have "no check".
- **Edits are recorded as `aireos`** until the app has user logins.

---

## Part J. Glossary

| Term | Meaning |
|---|---|
| Uplift | How much more (or less) a month with a mechanic sells than an ordinary month |
| Mechanic / key | The promotion form ("30% Off") and its standard key (`pct_off_30`) |
| Anchor | A customer's ordinary-month discount; rule-based uplifts are worked out from it |
| Rule (rate) | +0.4% sales per extra point of discount deeper than normal (editable); 5 points deeper → +2% |
| Rule-based / Measured / Estimate / Learned | Where an uplift came from: the rule / the job / a person / the model (future) |
| SKU's own uplift / customer's own uplift | What one SKU's sales say / the customer's SKUs' own uplifts, volume-weighted |
| Blended customer uplift / blended SKU uplift | The customer's own uplift leaning on the rule-based uplift / the SKU's own uplift leaning on the blended customer uplift |
| Window | The months in `fc_training_input`; the measurement uses exactly these |
| Exposure | How much of a month a mechanic counts for, at the customer's usual reach |
| Usual reach | How much of a customer's sales an ordinary promotion month reaches |
| Contrast | A SKU has months both with and without the mechanic |
| n / N | A SKU's months of evidence / the customer's |
| Starting weight (k) | How many months of evidence the level above counts as (3) |
| Holdout model | A copy of a model trained without the last few months, used to test it |
| Backtest month forecast | What a holdout model forecast for a month it didn't see |
| Append-only | Rows are never changed or deleted, only superseded |
| Tier 1 basic / advanced / Tier 0 | ARIMA_PLUS / ARIMA_PLUS_XREG / the P&L formula |
