# Forecast cloud readiness (updated 5 November 2026)

## Current event refresh handover

- Sandra's live forecast dataset is `aire-data.aireos_forecast_validation_sg` in Singapore. The old `Aire_Data_Analytics` dataset is frozen; the raw Datastream copy remains in `aire-data.aireos_cdc_sg`. The historical checks below describe how that move was prepared, not the current forecast source.
- The backend now reads the forecast dataset and CDC dataset through `BQ_FORECAST_DATASET` and `BQ_CDC_DATASET`. It records sales, promotion and SKU archive/restore changes in the SQL inbox, queues a Cloud Task after commit, waits for the matching CDC rows, and calls `retrain_if_new_month(TRUE)` with the `fc_event` label. The Forecast page schedules a background recovery check for stalled requests.
- If the latest save in a batch has not reached BigQuery within `FORECAST_REFRESH_MAX_WAIT` (default `2h`), or Cloud Tasks exhausts its retries, the worker marks pending requests failed and attempts a `forecast_failure` notification. The limit does not apply during the five-minute quiet period or after the data has landed. Migration [010](../backend/migrations/010_forecast_sku_changes.sql) allows the new SKU event kind and restored history action. Nisha applied it successfully in Singapore `aireos` on 5 November. It changes CHECK constraints only; Datastream needs no new columns for this migration.
- Project BigQuery Job User and dataset `WRITER` / `READER` access for `aireos-api@aire-data.iam.gserviceaccount.com` were confirmed in Cloud Shell on 5 November. Sandra's `retrain_if_new_month` procedure was also confirmed in `aireos_forecast_validation_sg`. Queue enqueuer, act-as and Cloud Run invoker were confirmed earlier. `FORECAST_REFRESH_ENABLED` remains `false` in the branch's deploy settings until deployment and an end-to-end test pass.
- Cloud Run `aireos-api-test` was checked in Cloud Shell on 5 November: its URL is `https://aireos-api-test-p3fmc4khfq-as.a.run.app`, it runs as `aireos-api@aire-data.iam.gserviceaccount.com`, minimum instances are `0`, and its service IAM grants `roles/run.invoker` to `forecast-refresh-invoker@aire-data.iam.gserviceaccount.com` with no public `allUsers` binding in the returned policy. The task URL in the branch matches this service URL. Live revision `aireos-api-test-00011-mjw` has none of the four new forecast dataset/refresh env vars, so the branch's event flow is not deployed or enabled there.
- The notification panel labels event runs "Sales/promotion change", shows a refresh that never started as "Forecast refresh couldn't start" with its reason, and lists errors only when they add to the reason. The wording lives in `frontend/aireos/app/utils/forecastNotificationText.js` and is covered by `npm test`.
- This is event driven. The old scheduled query and Pub/Sub notification listener stay off. A change made directly in SQL or BigQuery needs a manual retrain; the next app save and Forecast-page recovery cover missed app events.
- Sandra's 5 November handover says the forecast now evaluates partial months per customer, so the earlier recommendation below to exclude all September data is superseded. Confirm the deployed procedure and views use that rule during the end-to-end test.

## Historical 4 November investigation

## 4 November check

- The six live forecast source views still match the saved rollback definitions from 2 November. The prepared cutover changes only their raw `public_*` table references; it has not been applied. Eight BigQuery routines have no direct `public_*` references.
- Singapore Cloud SQL has the 1,463 monthly rows from January–September 2026. On 4 November, two FairPrice weekly files were restored from the old BigQuery copy: 2,348 rows from Dec 2024–Dec 2025 and 2,588 rows from Jan–Jul 2026. The 4,936 weekly rows have completed ingestion runs 42 and 43. Datastream delivered all of them to BigQuery, where a key-by-key comparison found zero missing rows and zero quantity or revenue mismatches. The separate local 2023–2024 file was excluded at the user's request.
- File-level recheck: FairPrice August 2026 monthly data (121 rows), NHG June–August (9 rows each), and Sheng Siong June (75 rows) are in Singapore SQL and its BigQuery copy. NHG uses new retailer ID `940` and store code `__all__` instead of old `456`/`NHG`; Sheng Siong uses retailer IDs `906`/`907` instead of `460`/`461`, and its filename has one `.xlsx` suffix instead of two. Thus an old-versus-new raw business-key anti-join still flags these logically present monthly rows.
- After normalizing those migrated retailer and outlet identifiers, all restored NHG and Sheng Siong rows match the old copy by SKU, period, quantity and revenue: zero rows missing on either side and zero value mismatches. FairPrice August monthly rows also have zero missing keys and zero quantity/revenue mismatches.
- Singapore SQL has `doh_settings` but no `customer_doh_targets` table. The prepared foundation view retains the old BigQuery `public_customer_doh_targets` reference. `fc_training_input` and `fc_future_input` do not select DOH target fields; the inventory app gets its DOH settings from Singapore SQL. Keeping the old reference leaves the foundation view's target fields stale, but does not prevent those forecast inputs from reading sales.
- Singapore SQL had 3,751 orphan promotion-store links across 302 promotions. On 4 November, the approved all-current-stores repair restored Prime's 14 reviewed outlets, saved the old IDs to `gs://teamwipdev/backfills/promotions/orphan-store-links-before-2026-11-04.csv`, and re-linked the five import batches in one transaction. SQL and BigQuery now have the same 7,375 links and 373 promotion IDs, with **zero missing, extra, or orphan links**. The staging promotion view sees all 373 promotions, including 29 active/future promotions.
- Singapore Datastream has now delivered all 4,936 restored FairPrice weekly rows. A key-by-key comparison to the old BigQuery weekly copy found zero missing keys and zero quantity/revenue mismatches. The live six forecast source views remain unchanged.
- Nine isolated Singapore-backed candidate views were created in BigQuery dataset `aire-data.aireos_forecast_validation_sg` using [stage_forecast_sg_views.py](../backend/scripts/stage_forecast_sg_views.py): the six cutover source views plus copies of Sandra's `fc_promo_calendar_monthly`, `fc_training_input`, and `fc_future_input`. All nine schemas match the live views. The candidate monthly sales view matches FairPrice totals for January–August 2026 and all 2025 sales. FairPrice's training input is identical to live (20 months, 44,126 units); Singapore also has additional Sheng Siong and SingHealth months and current customer IDs. The candidate promotion calendar has 675 rows across five customers, and the future input has 495 rows across four customers. These are staging views; Sandra's live views and model procedure were not changed.
- **Historical 4 November concern, superseded by Sandra's 5 November handover:** the candidate training input's latest month was September 2026, with SingHealth alone (9 SKU series, 189 units); August had 33 series and 4,465 units across four customers. The then-current aggregate partial-month checks would have rejected that September input. Sandra's newer per-customer completeness rule is intended to handle customers with different latest months; verify it in the deployed procedure during the end-to-end test. The historical sales and promotion CDC reconciliation was complete.
- The repaired links formed five import batches: promotions 137–190 (Sheng Siong offline), 194–277 (Sheng Siong online), 290–390 (Prime), 404–436 (NHG), and 440–472 (SingHealth). Their old links are preserved in the GCS snapshot above.
- Event-driven forecast refresh code is prepared on this branch and disabled in [test deployment config](../deploy/test/api.env.yaml). It records sales/promotion changes in the same SQL transaction, queues an authenticated delayed check, waits for exact SQL facts and promotion links to match Singapore CDC, then calls Sandra's deployed `retrain_if_new_month(TRUE)` procedure using a stable BigQuery job ID. If the routine finds another run busy, the worker leaves the request pending and retries with a new job ID. [Migration 008](../backend/migrations/008_forecast_refresh_status.sql) was applied and verified in Singapore SQL. A completed no-op outbox row (ID 1) was inserted and delivered to BigQuery to prove the new table replicates; it cannot start a forecast job. After the September input issue is resolved, cut over and verify the views, deploy the backend, then enable `FORECAST_REFRESH_ENABLED` and test one sales upload and one promotion change. No event retrain has been triggered yet.

## Verified state on 2 November

- The backend points to `aire-data:asia-southeast1:aireos-postgresql`, database `aireos`. The instance is running in `asia-southeast1`.
- BigQuery dataset `aire-data.Aire_Data_Analytics` is also in `asia-southeast1`.
- Singapore SQL has publication `aireos_sellout_pub` with the sales, promotion, catalog, customer and inventory source tables, and role `datastream_sellout`. The logical slot `aireos_sg_analytics_slot` has been created in `aireos` for the new stream.
- Migration `007` has been applied in Singapore `aireos`: `forecast_refresh_requests` exists, is included in `aireos_sellout_pub`, and the deployed API and Datastream database users have the required access.
- Two older Datastream streams, `aireos-sellout-to-bigquery` and `aireos-to-analytics`, remain in `us-central1`. The replacement `aireos-sg-to-bigquery` has started in `asia-southeast1`.
- `aireos-to-analytics` reads `35.239.161.4:5432/promotions` from its US source profile and writes in merge mode to `aire-data:Aire_Data_Analytics` (900-second freshness). It is the old database connection, not Singapore `aireos`.
- The Singapore role `datastream_sellout` now has `LOGIN`, `REPLICATION`, and `SELECT` on every published table. The new BigQuery dataset `aire-data:aireos_cdc_sg` has been created in `asia-southeast1`.
- The new stream `aireos-sg-to-bigquery` was created with automatic backfill, merge mode and 12 included tables. Cloud Shell now reports `RUNNING` with no errors. The replication slot is active, and the backfill populated 11 nonempty source tables. The empty `forecast_refresh_requests` table has not yet appeared in BigQuery; check it when the first inbox row is written.
- Read-only backfill verification: all 11 populated table counts match Singapore Cloud SQL (`sellout` 813, `promotions` 385, `promotion_stores` 7,296, `promotion_skus` 1,206, `inventory_metrics` 546, `stores` 94, `skus` 11, `retailers` 8, `customer_retailers` 8, `inventory_metric_types` 7, `customers` 4). All 813 sell-out business keys, quantities, revenues and source filenames match; all 385 promotion IDs match. These are snapshot checks, not yet a test of a new post-start change.
- **Forecast view cutover is blocked on source-data reconciliation.** The new Singapore sell-out has only monthly FairPrice January–July 2026 (813 rows). The old BigQuery copy has 5,972 rows: 2025 weekly data (2,324), 2026 weekly data (2,588), and monthly data through August 2026 (1,036). The existing `fc_training_input` uses all 12 months of 2025 and January–August 2026. Its 2026 June–August monthly rows include NHG and Sheng Siong sales absent from Singapore SQL; August also includes FairPrice. Do not run the cutover SQL until this history is restored or the forecast owner accepts the shorter input explicitly.
- An old-versus-new sell-out business-key comparison found exactly 5,159 rows absent from Singapore, across seven source files: FairPrice weekly 26 Dec 2024–25 Dec 2025 (2,348), FairPrice weekly 2026 (2,588), FairPrice monthly August 2026 (121), Sheng Siong June 2026 claim file (75), and NHG June, July and August files (9 each). The 813 Singapore rows match old business keys; the missing rows explain the entire count difference. Check the original files, mappings and current ownership before restoring them; do not copy the stale BigQuery snapshot directly into production SQL without review.

  | Old source file | Business keys missing from Singapore |
  | --- | ---: |
  | `XEL_VENDORS_BRANDS_WEEK_26-12-2024_25-12-2025_1.txt` | 2,348 |
  | `XEL_VENDORS_BRANDS_WEEK_01-01-2026_13-08-2026_1.txt` | 2,588 |
  | `XEL_VENDORS_BRANDS_MONTH_01-01-2026_01-08-2026_1.txt` (August only) | 121 |
  | `Claim_Sales_Summary_Report_XLPL_CSTANG_P100045355_03JUL26.xlsx.xlsx` | 75 |
  | `Aire Sell Out June 26.xlsx` | 9 |
  | `Aire Sell Out Jul.xlsx` | 9 |
  | `Aire Sell Out Aug 26.xlsx` | 9 |
- Existing forecast views have **not** been repointed, so their current Actual and training inputs still see the old BigQuery tables. The Sales Dashboard and inventory sell-out reads use Singapore Cloud SQL directly; while the test deletions remain there, those features can show reduced history and no weekly breakdown.
- Six forecast source views still directly reference the older `Aire_Data_Analytics.public_*` copies. Their Singapore replacements passed BigQuery dry runs and are saved as [cutover SQL](forecast_sg_view_cutover.sql), with [rollback SQL](forecast_sg_view_rollback.sql). Neither file has been run. `public_customer_doh_targets` is retained in `Aire_Data_Analytics` because it is a separate table, absent from the new CDC dataset. The new `public_customers` lacks the old `alert_enabled` and `alert_updated_at` columns; none of the six forecast source views references them.
- The Singapore SQL source has public IP `34.143.252.222`, requires encrypted connections, and has logical decoding enabled. Its authorized public network list now contains the five Singapore Datastream `/32` addresses; the list was empty before the change. The source profile's connection test passed, but initial stream validation failed because its server certificate hostname was set to the IP rather than the instance DNS name.
- Singapore SQL has 813 sell-out rows (newest load 1 Nov) and 385 promotions (highest ID 472). The BigQuery `public_sellout` copy has 5,972 rows (newest load 27 Oct), and `public_promotions` has 71 (highest ID 121). The copies do not reflect the new database.
- `fc_promo_calendar_monthly` already expands weekly side offers, replaces monthly mechanics on overlapping days, and generates monthly model labels. It currently sees the stale `public_*` copies.
- Deployed `retrain_if_new_month` has no arguments and only checks for a new month. The `Retrain when new month lands` scheduled query is disabled and still calls it once daily without arguments.
- Cloud Tasks API is enabled for project `aire-data`. Queue `forecast-refresh` is `RUNNING` in `asia-southeast1`, with one concurrent dispatch, one dispatch per second, at most 10 attempts, and 60–600 second retry backoff. It has no backend task producer or handler yet.
- Dedicated task caller `forecast-refresh-invoker@aire-data.iam.gserviceaccount.com` exists. The test API service URL is `https://aireos-api-test-p3fmc4khfq-as.a.run.app`. Cloud Shell confirms the API service account has `roles/cloudtasks.enqueuer` on the queue and `roles/iam.serviceAccountUser` on the caller; the caller has `roles/run.invoker` on the test API; the Cloud Tasks service agent also has `roles/iam.serviceAccountUser` on the caller.
- The backend service account can inspect Cloud SQL and BigQuery but cannot list Datastream streams, Cloud Run services or IAM service accounts. The team Cloud Shell account supplied the old stream configuration.

## Order of work

1. The existing `aireos-to-analytics` stream is confirmed to read the US host and old `promotions` database. Keep both US streams running until the replacement is validated. The other US stream can be inspected separately if needed; neither can consume Singapore SQL without a Singapore replication slot.

2. [007_create_forecast_refresh_requests.sql](../backend/migrations/007_create_forecast_refresh_requests.sql) has been run and verified against Singapore `aireos`. Do not create a logical slot long before the stream is ready: retained WAL can grow while a slot is idle.
3. The Singapore Datastream role has already been granted replication rights, and the separate BigQuery dataset has already been created. These checks returned `rolreplication = true` and dataset location `asia-southeast1`:

   ```sql
   ALTER ROLE datastream_sellout WITH REPLICATION;
   SELECT rolname, rolcanlogin, rolreplication
   FROM pg_roles WHERE rolname = 'datastream_sellout';
   ```

   The Cloud Shell commands used to create and check the dataset were:

   ```bash
   bq --location=asia-southeast1 mk --dataset aire-data:aireos_cdc_sg
   bq show --format=prettyjson aire-data:aireos_cdc_sg
   ```
4. [Datastream's five Singapore public IPs](https://cloud.google.com/datastream/docs/ip-allowlists-and-regions) have been added to the Singapore Cloud SQL instance as `/32` networks. The instance had no authorized public networks before this change. The Cloud Shell commands were:

   ```bash
   gcloud sql instances patch aireos-postgresql --project=aire-data \
     --authorized-networks=34.87.56.130/32,35.186.145.36/32,35.240.226.116/32,34.87.108.57/32,34.126.64.172/32
   gcloud sql instances describe aireos-postgresql --project=aire-data \
     --format='json(settings.ipConfiguration.authorizedNetworks)'
   ```

5. The team used the **manual** Datastream stream wizard in `asia-southeast1` (the automated Cloud SQL flow needs private services access, which this instance does not have). The Singapore PostgreSQL source profile `aireos-sg-postgres-source` was configured with host `34.143.252.222`, port `5432`, database `aireos`, user `datastream_sellout`, its database password entered in the Console, **Server-only TLS** with the Cloud SQL server CA certificate, and IP allowlisting. Its connection test **passed**. The BigQuery destination profile `aireos-sg-bigquery-destination` was created in `asia-southeast1`; its dataset was selected in the stream wizard. Datastream accepts a single PEM certificate for this setting. The slot was created immediately before stream validation/start:

   ```sql
   SELECT * FROM pg_create_logical_replication_slot('aireos_sg_analytics_slot', 'pgoutput');
   ```

   Run this SQL while connected as `datastream_sellout`, whose `rolreplication` is true. Cloud SQL Studio's `postgres` session has `rolreplication = false` and failed to create the slot. For the shared-CA TLS profile, keep the connection host as the public IP but set **Server certificate hostname** to `e1cca931930b.xf2ek5jn2p76.asia-southeast1.sql.goog.` from the Cloud SQL instance's `dnsNames` field. The initial validation error was a hostname-verifier failure because the profile had the public IP in that certificate-hostname field.

   The slot was created successfully in Singapore `aireos` with LSN `14/18000348`; it subsequently became active and advanced. The stream uses this slot and `aireos_sellout_pub`, 12 published `public` tables (`customer_retailers`, `customers`, `forecast_refresh_requests`, `inventory_metric_types`, `inventory_metrics`, `promotion_skus`, `promotion_stores`, `promotions`, `retailers`, `sellout`, `skus`, `stores`), single target dataset `aireos_cdc_sg`, merge mode and automatic backfill. The first full validation passed all eight checks. The existing `Aire_Data_Analytics.public_*` tables contain an older database snapshot; keep the new stream in its separate dataset.
6. The stream is `RUNNING`, and the 11 populated tables passed count and business-key comparisons. Reconcile the missing sales history in Singapore SQL first. After the source data is complete, test one new post-start source change reaching BigQuery. Sandra should review the six-view [cutover SQL](forecast_sg_view_cutover.sql), which changes only source references and leaves model/procedure/output objects untouched. Apply it in BigQuery only after that review and history reconciliation, then test `fc_training_input`, `fc_future_input`, `fc_promo_calendar_monthly`, and forecast page reads. The companion [rollback SQL](forecast_sg_view_rollback.sql) restores the captured old view definitions if needed. Keep the old streams until the forecast cutover is checked.
7. Sandra's deployed `retrain_if_new_month(assume_settled BOOL)` is the event worker's target. Keep the old scheduled query disabled; this design uses Cloud Tasks and Forecast-page recovery rather than an hourly timer.
8. The test deployment is Cloud Run service `aireos-api-test` in `asia-southeast1`, running as `aireos-api@aire-data.iam.gserviceaccount.com` (from `deploy/test/target.env`). The Cloud Tasks API, `forecast-refresh` queue and `forecast-refresh-invoker@aire-data.iam.gserviceaccount.com` caller identity are ready. The queue-scoped enqueuer, API-scoped invoker, and both service-account-user bindings have been applied and verified in Cloud Shell. Only wire tasks after the authenticated backend endpoints exist. The existing browser session-cookie dependency cannot authenticate an OIDC Cloud Task; the internal handler must verify the task token and remain outside cookie-protected routers. Queue dispatch concurrency by itself does not guarantee one active BigQuery forecast job: the endpoint must hold or check an application-level run lock until the BigQuery job finishes.

## Checks after the Datastream change

Run in Singapore Cloud SQL Studio:

```sql
SELECT slot_name, database, active FROM pg_replication_slots;
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'aireos_sellout_pub' ORDER BY tablename;
SELECT COUNT(*) AS sellout_rows, MAX(loaded_at) AS latest_sale FROM sellout;
SELECT COUNT(*) AS promotion_rows, MAX(promotion_id) AS latest_promotion_id FROM promotions;
```

Run in BigQuery against the **new CDC dataset**:

```sql
SELECT COUNT(*) AS sellout_rows, MAX(loaded_at) AS latest_sale
FROM `aire-data.aireos_cdc_sg.public_sellout`;
SELECT COUNT(*) AS promotion_rows, MAX(promotion_id) AS latest_promotion_id
FROM `aire-data.aireos_cdc_sg.public_promotions`;
SELECT COUNT(*) AS inbox_rows, MAX(id) AS latest_request_id
FROM `aire-data.aireos_cdc_sg.public_forecast_refresh_requests`;
```

After backfill and CDC catch-up, the copied tables should match the source's business keys and latest IDs. Compare a particular newly saved sale/promotion too; matching total counts alone can hide stale rows.

## Two implementation constraints for AO5-29/30

- Insert the inbox row **inside the same Cloud SQL transaction** as the promotion or sell-out write. Enqueue the delayed Cloud Task after commit. A separate inbox insert after commit can be lost while the data save succeeds, contrary to AO5-30.
- Seeing the inbox row in BigQuery does **not** prove every sell-out row from the same upload is there: Datastream processes tables separately. The refresh check must validate the uploaded batch's expected rows or a source watermark in the forecast inputs before starting a job. A later app save or the Forecast page's recovery check can re-queue a missed task; neither replaces this readiness check.

Google reference: [PostgreSQL publication and replication slot](https://cloud.google.com/datastream/docs/configure-your-source-postgresql-database), [Create a stream and BigQuery destination](https://cloud.google.com/datastream/docs/create-a-stream).
