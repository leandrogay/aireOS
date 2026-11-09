# BigQuery analytics views

These scripts build reusable analytics views in
`aire-data.Aire_Data_Analytics` on top of the Cloud SQL tables replicated by
the replacement Datastream stream into the same dataset. This keeps the whole
new pipeline isolated from legacy objects in `aire-data.Aire_Data`.

They do not copy, update, or delete raw data. `CREATE OR REPLACE VIEW` only
stores query definitions.

## Views

| View | Grain | Purpose |
| --- | --- | --- |
| `v_inventory_history` | Customer + SKU + month | Selects the latest historical metric snapshot and chains monthly opening/ending inventory |
| `v_sales_enriched` | Sell-out business key | Adds retailer, store, and SKU descriptions to sales |
| `v_customer_monthly_sales` | Customer + SKU + month | Combines retailer channels for customer-level inventory analysis while retaining the channel split |
| `v_promotion_events_enriched` | Promotion + store + SKU | Retains every promotion field and relationship |
| `v_promotion_features_monthly` | Customer + SKU + month | Safely aggregates overlapping promotion events before a sales join |
| `v_forecasting_foundation_monthly` | Customer + SKU + month | Preserves sales, promotions, inventory, and target DOH as nested records |

`v_forecasting_foundation_monthly` is a reusable data foundation, not a final
model contract. Forecast-specific flat views can select only the fields needed
by a particular model without rebuilding or discarding the source detail.

## Run

Open the BigQuery query editor in project `aire-data`, paste
`views/000_create_inventory_history_view.sql`, and run it first. Then run
`views/001_create_forecasting_foundation_views.sql`. Both are safe to rerun
because every view statement uses
`CREATE OR REPLACE VIEW`.

Then run `views/002_validate_forecasting_foundation_views.sql`. The first
comparison should show matching raw/enriched sell-out counts, every duplicate
count should be zero, expected/actual promotion event counts should match, and
the effective-source/monthly quantity and revenue differences should be zero.

The foundation script expects `v_inventory_history` to expose
`customer_id`, `sku`, and `period_start`; its opening assertion stops the run
if that prerequisite is missing.

## Live forecast contract capture

On 2026-11-09, an authenticated read-only inspection was run against project
`aire-data`, location `asia-southeast1`. The application dataset is
`aireos_forecast_validation_sg`; `Aire_Data_Analytics` contains an older,
different Tier 0 definition and must not be used as the current application
contract.

The raw read results are retained as dated reference captures:

- `views/live_2026-11-09_aireos_forecast_validation_sg_fc_tier0_forecasts.txt`
- `views/live_2026-11-09_Aire_Data_Analytics_fc_tier0_forecasts.txt`
- `schemas/live_2026-11-09_aire_forecasting_output.txt`
- `schemas/live_2026-11-09_aire_forecasting_runs.txt`
- `procedures/live_2026-11-09_aireos_forecast_validation_sg_routines.txt`
- `procedures/live_2026-11-09_Aire_Data_Analytics_routines.txt`

These are reference copies only. They are not deployment migrations and must
not be applied automatically.

The validation dataset currently has `aire_forecasting_output` as a table,
not a view. Its current run is identified by
`current_generated_at = 2026-11-08 15:59:46 UTC`; the same timestamp appears
as `forecast_generated_at` in `aire_forecasting_runs`. This timestamp is a
provisional run key until the pipeline exposes a dedicated immutable
`forecast_run_id`.

The live validation Tier 0 view uses a per-customer/SKU `latest_month` and
averages the available months in the three-month window ending at that
month. When same-month-last-year actuals exist, its base is a 50/50 blend of
that value and the run-rate; otherwise it is the run-rate. The current
validation definition has no active growth factor. This differs from the
older `Aire_Data_Analytics` view, which still contains clipped growth logic.

The proposed application-facing fields and parity contract are documented in
`schemas/tier0_component_contract.md`. It deliberately keeps `growth`
nullable until the live validation pipeline writes a real growth value.

Phase 2 deployment material is read-only until reviewed:

- `procedures/phase-2_tier0_components_validation.sql` proposes nullable
  provenance columns and records the required pipeline-owner procedure edits.
- `queries/phase-2_tier0_component_parity.sql` compares the current output to
  the matching Tier 0 run.

These files are not invoked by the backend and have not been executed against
BigQuery.

The repository-only Phase 3 proposal adds:

- `views/011_create_validation_tier0_components_view.sql`, a replacement
  validation-dataset view that preserves the live no-growth formula while
  exposing the exact per-series component provenance.
- `procedures/phase-3_run_tier0_legacy.sql`, a replacement Tier 0 procedure
  that writes those components to the run table.
- `queries/phase-3_sync_output_components.sql`, a guarded synchronization
  statement for the current output rows.

These are reviewed deployment inputs only. The backend still uses its existing
forecast row shape until a live run has populated the new columns and the
parity query passes.

## Tier 0 legacy baseline

The Tier 0 forecast (the P&L sell-out formula from
`backend/app/services/pl_forecast.py`) runs inside the monthly forecast
pipeline as its own procedure, so it can change without editing the Tier 1
procedure.

| Object | Kind | Purpose |
| --- | --- | --- |
| `fc_tier0_forecasts` | View (`views/010_…`) | The formula recomputed from every past month as a cut-off: latest cut-off = live forecast, 3 months back = holdout, earlier = past errors |
| `run_tier0_legacy(run_ts)` | Procedure (`procedures/run_tier0_legacy.sql`) | Writes Tier 0's holdout score to `fc_model_quality_log` and its 13-month forecast with an 80% range to `aire_forecasting_runs`, as `tier0_legacy` |

It reads only `fc_training_input` and `fc_future_input`, and writes only the
pipeline's own tables. To deploy: run `views/010_create_tier0_legacy_forecasts_view.sql`,
then `procedures/run_tier0_legacy.sql`, then apply the two edits in
`procedures/pipeline_tier0_changes.sql` to `run_monthly_forecast_pipeline`.

Before deploying a change to the formula, run
`python scripts/check_tier0_parity.py` from `backend/`. It runs the view's
query read-only and checks it against `pl_forecast.py` on live data.

Tier 0 has no promotion uplift. The P&L's Sell-out Building Blocks are
hand-entered activity cartons (AO, display, expansion, promoter sampling) that
the database doesn't hold; promotion effects come from Tier 1 XREG.

## Important grain decisions

- FairPrice sales and promotions remain separated in the raw tables as
  `fairprice_online` and `fairprice_offline`.
- Monthly sales retain the established forecasting field names
  `quantity_cartons`, `online_quantity_cartons`, and
  `offline_quantity_cartons`. The retailer export labels the source measure
  `Qty (in EA)` and the ingestion pipeline does not perform a numeric unit
  conversion; any future unit-contract change must be coordinated with the
  forecasting consumers.
- Inventory is supplied at combined customer level, so the monthly foundation
  combines both channels through `public_customer_retailers`.
- Monthly sell-out is authoritative for a retailer + calendar month whenever
  it exists. Weekly rows are retained only for retailer-months without monthly
  coverage, so uploading both granularities never doubles the monthly facts.
- Weekly sales are assigned to the month containing `period_start`. This is
  stated explicitly in the view and can be replaced with a proration rule if
  the forecasting team later requires it.
- Promotion events are aggregated before they meet monthly sales. This prevents
  multiple stores or overlapping promotions from multiplying quantity and
  revenue.
