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
the raw/monthly quantity and revenue totals should match.

The foundation script expects `v_inventory_history` to expose
`customer_id`, `sku`, and `period_start`; its opening assertion stops the run
if that prerequisite is missing.

## Tier 0 legacy baseline

The Tier 0 forecast (the P&L sell-out formula from
`backend/app/services/pl_forecast.py`) runs inside the monthly forecast
pipeline as its own procedure, so it can change without editing the Tier 1
procedure.

| Object | Kind | Purpose |
| --- | --- | --- |
| `fc_tier0_forecasts` | View (`views/010_…`) | The formula recomputed from every past month as a cut-off: latest cut-off = live forecast, 3 months back = holdout, earlier = past errors |
| `run_tier0_legacy(run_ts)` | Procedure (`procedures/run_tier0_legacy.sql`) | Writes Tier 0's holdout score to `model_quality_log` and its 13-month forecast with an 80% range to `aire_forecasting_runs`, as `tier0_legacy` |

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
- Weekly sales are assigned to the month containing `period_start`. This is
  stated explicitly in the view and can be replaced with a proration rule if
  the forecasting team later requires it.
- Promotion events are aggregated before they meet monthly sales. This prevents
  multiple stores or overlapping promotions from multiplying quantity and
  revenue.
