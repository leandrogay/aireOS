# Budget planning and locked comparisons

C and D add a Budget planning mode inside Scenario builder and a locked Budget comparison on Forecast and Inventory. Apply `backend/migrations/026_budget_planning.sql` after 025 before running the updated app. No BigQuery DDL or pipeline writes are needed.

## Planning

The mode opens on next year's Tier 0 Initial Yearly Forecast. Growth and building blocks apply to Initial. Budget promotions work on its ordinary-month baseline and replace the carried historical promotion effects for the share of each month they cover; combined shares remove the carried component at most once. Months without a budget promotion retain their carried effects. Current-mode entries retain `plan='scenario'`; budget entries have `plan='budget'`. Growth uniqueness includes the plan. Updates and deletes cannot move an entry between plans. Inventory's manually selected building-block overlay only accepts scenario entries.

The Breakdown tab splits Initial into **Baseline at the anchor** and **Carried promotion effects**, with Initial's data cut-off visible. `GET /api/scenario/tier0-breakdown?basis=initial&year=2027` reads that year's `aire_forecasting_initial_meta.data_cutoff` and restricts training history to it. Each SKU uses its own latest available month within that cut-off. Historical moments and their baselines are rebuilt from those source months rather than today's cached moments, which can include later sales. Anchors and mechanic discounts use their recorded versions for each source month. Expanded monthly rows show the source months and anchors per customer × SKU.

This is a reconstruction from recorded sales and promotion/anchor history, not a new BigQuery forecast or an immutable archive of every old input revision. Each reconstructed Tier 0 must match the published Initial within one carton; rounding is reconciled proportionally so baseline plus carried effects equals the exact published value. Missing origins, revised history that no longer reconciles or invalid values block Budget preview and locking with an explanation. The Current split is never substituted. Future official promotions are not automatically copied into Budget; Budget-mode promotions control replacement there.

An unconfigured historical mechanic with explicit percentage-off text (for example, **33% Off**) can use that stated discount in the existing placeholder formula. Its source records and expanded details label the discount as read from promotion text and the uplift as a rule estimate. A saved historical discount takes precedence. Other unreadable or unavailable mechanics block the split instead of being treated as 0% uplift. This fallback does not create or edit settings.

Each mode keeps its working copies mounted, so switching preserves drafts. The budget's units blocks use the whole Initial year when allocating units across a filtered chart. Budget promotions use their saved references, including each customer's and product's uplift and voucher. Choosing a mechanic or changing customer/SKU scope copies references from settings; a plain save keeps those copied values. Budget entries must stay within a single calendar year.

The mechanic's expected uplift and **Edit** action share one card, above vouchers. The slider only opens after Edit; opening or closing it leaves the applied values alone. Moving it sets a shared override, and **Use expected uplift** restores each pair's own value. The calculation disclosure lists included customer × SKU pairs and their periods, including anchor changes, rule inputs or measured moments and saved fallbacks. New copied references keep those explanations in the existing per-customer JSON; no migration is needed. Older promotions without a stored explanation say so instead of substituting today's settings.

Both saved-item tables list all saved entries in their own mode, including inactive entries and entries outside chart filters. Local search/paging change the table list; gain figures remain scoped to the chart. Saved promotions now use a table with Edit, persisted active switches and confirmed deletion; the sidebar retains drafts and the current edit. Refresh preserves unsaved work. Hover/focus on a Breakdown contribution spotlights only its matching chart bands (including source-specific hatched decreases), without changing the stack or simulation.

## Locking and history

Save or discard drafts before pressing **Lock budget**. The confirmation locks the complete year, for all customer × SKU series with an Initial forecast, regardless of chart filters. The backend reads Tier 0 Initial again and calculates from saved budget entries; the browser never supplies frozen totals. A series with no Initial is excluded; any included series without twelve distinct January–December months blocks the lock. No automatic January lock is scheduled.

`budget_snapshots` records year, version, UTC timestamp, authenticated email and the copied inputs/source stamps. `budget_snapshot_rows` freezes units by stable customer id × SKU × month, alongside names and ranges. Version allocation is serialized per year; snapshot header and rows are one transaction. Every lock appends a version. Changing a forecast, setting, catalog entry or budget entry does not rewrite older units. Catalog deletion does not cascade into history.

New locks also retain the reconstructed Initial breakdown and cut-off in the snapshot's existing `inputs` JSON. The server uses that split for the same promotion-replacement calculation as the preview. Earlier locked versions keep their previously stored units and inputs; this change requires no new migration after 026.

`GET /api/scenario/budgets` returns history and the latest rows per year. `?year=2027&version=1` reads an earlier version. `POST /api/scenario/budgets/lock` accepts `{ "year": 2027 }`; the server supplies identity and calculates units. List APIs for blocks and promotions accept `?plan=scenario|budget`, defaulting to scenario; write bodies carry `plan`, and DELETE takes it as a query parameter.

## Comparisons

Sell-Out Forecast draws Budget from the latest snapshot per year, with its own colour and toggle. It follows customer, product and date filters and remains the same when the selected forecast model changes. Missing budget months are gaps; zero is a real value.

Inventory reads frozen budget sell-out by stable customer id and SKU. Its Budget sell-in line is recalculated using the existing sell-in planner, inventory actuals, shipments and DOH thresholds. Current forecast bridges months before a budget begins, and only budget months are shown on the Budget line. The budget sell-out units are frozen; the resulting sell-in recommendation can change as stock or DOH settings change. Current plans, tables and saved sell-in snapshots retain their existing inputs.

Sell-in Budget uses olive, while Sell-out Budget retains the burgundy used for Budget on Forecast. Their dash patterns also differ; lines, legend toggles and tooltip markers share those colours.

## Validation and deployment

Tests cover plan isolation and validation, full-year locking, append-only versions, customer/product uplifts and vouchers, exact-day proration, units allocation, zero floors, filtered Budget totals and Inventory calculation independence. All automated tests use fakes; no shared database or live backend is used. Apply the migration with approval, then check both modes, a first lock and a second version, Forecast filtering/toggles, and Inventory's Budget lines against the shared dev data before deployment.

### Local validation on 12 November 2026

- Backend: 2,042 passed, 25 skipped; external network connections blocked during tests.
- Frontend: lint clean; 340 tests passed; the budget workspace rendered with an Initial base and growth applied independently of Current.
- Approved live read: 2027 Initial has 50 complete customer x SKU series (600 monthly cells).
- The initial attempt to apply migration 026 was refused because the runtime IAM database user did not own the scenario tables. That attempt rolled back. A later approved read-only check confirmed the schema had since been applied (see below). No budget entries or lock snapshots were created by the agent during verification.

### Migration compatibility verification

Current-mode item services now detect whether their table has a plan column. Before 026, existing rows remain usable as scenario entries for reads and writes; budget-scoped requests return a clear setup-required response before any write. Inventory treats absent snapshot tables as no Budget line, while Forecast can report setup without breaking its existing lines. Schema checks are not cached, so applying 026 takes effect on subsequent requests.

A later read-only dev check confirmed both plan columns, both snapshot tables and the growth-per-plan index are now present. Current-mode reads loaded 7 building blocks; budget items and snapshot history were empty. No planning data was written during verification. Backend: 2,052 passed, 25 skipped.

### First-draft review on 12 November 2026

Initial's historical split is now implemented. Approved shared-dev read verification for 2027 found a cut-off of October 2026 and 600 reconciled customer × SKU × month cells, with zero unavailable cells, zero missing source uplifts and zero reconciliation error. Totals: published Initial 62,215 cartons = anchor baseline 64,589.0389 + carried promotion effects −2,374.0389. Carried effects can be negative when historical promotions were below their source anchors. Historical 33% Off entries without a configured uplift use the labelled rule estimate above. No budget version was created by this verification.

Frontend tests cover Initial-only source selection and split/preview reconciliation; backend tests cover cut-off history, measured-moment rebuilding, per-SKU latest months, rounding, missing/mismatched origins, replacement, exact dates, overlaps, exclusions and retained snapshot provenance. Component render checks cover the complete Budget preview and replacement. The full live lock/re-lock/history/filter browser workflow remains pending. Other remaining items are listed in [Scenario builder handover](scenario-builder-handover.md#5-known-gaps-and-follow-ups).

Latest checks: frontend lint passed, 361 frontend tests passed, and 2,073 backend tests passed with 25 skipped; external connections were blocked during backend tests. Expanded Initial source-detail render checks also passed.
