# AGENTS.md — Architecture & Context Map for aireOS

This is the map. [CLAUDE.md](CLAUDE.md) is the rulebook. Read this before touching code so
you know which folder owns a concern, how data moves, and which "hat" to wear.

aireOS (Team WIP × Aire, final-year project) is an internal operations tool for a diaper/
personal-care brand selling through retailers (FairPrice first). It ingests retailer sellout
spreadsheets, shows a sales dashboard, manages promotion events, and tracks inventory (ending
stock, days of holding, DOH thresholds, a sell-in plan), and forecasts sell-out.

---

## 1. Repository layout

A folder-level map: what each folder owns, plus the files the rules point to as models. File-level
detail lives with its domain in §2 and §3.4 -- look there (or `ls`) for a specific module.

```
aireOS/
├── .github/workflows/ci.yml   CI: backend pytest (Python 3.15, no cloud creds) + frontend lint and node --test
├── .vscode/tasks.json         "Start Both Servers" task (uvicorn + next dev)
├── deploy/                    Cloud Run: <env>/ settings + secret names (test/ today), deploy.* and
│                              setup-secrets.* (ps1 + sh), cloudbuild.web.yaml
├── bigquery/                  BigQuery view DDL (forecast foundation, Tier 0, inventory history) + README;
│                              applied by hand, never by the app
├── docs/                      Design notes (data pipeline, forecast cloud readiness, promotion pricing) and the
│                              forecast view cutover/rollback SQL
├── outputs/                   (tracked) output of one-off scripts kept for the record, e.g. the
│                              inventory-history-import SQL
├── transformation_features.json (gitignored by the root *.json rule) local notes listing what each mapping
│                              module does; not read by anything
├── README.md                  Setup, deploying, the mapping workflow
├── CLAUDE.md / AGENTS.md      The rulebook / this map
│
├── backend/                   FastAPI app -- run: uvicorn app.main:app --reload (:8000); Dockerfile for Cloud Run
│   ├── app/
│   │   ├── main.py            FastAPI() instance, CORS (explicit list), lifespan (notification listener),
│   │   │                      routers mounted with dependencies=[Depends(require_user)] (all but auth and
│   │   │                      internal_forecast); GET /
│   │   ├── config.py          The only reader of .env.backend / os.environ; every setting is a constant here
│   │   ├── auth.py            require_user dependency, current_user_email (writes record it as updated_by)
│   │   ├── middleware.py      UnhandledErrorMiddleware (unhandled exceptions → JSON 500 with CORS headers)
│   │   ├── notification_stream.py  Postgres LISTEN (asyncpg) → server-sent notification stream
│   │   ├── assets/            aire-logo.png for exported PDFs and slides
│   │   ├── data/              Forecast output mock rows + schema (local/dev reference)
│   │   ├── routers/           HTTP layer, one file per URL prefix: uploads, mappings, sales, catalog,
│   │   │                      promotions, forecast, inventory, notifications, assistant, ai_models, auth (public),
│   │   │                      internal_forecast (/internal/forecast) and internal_promo (/internal/promo/recalc):
│   │   │                      Cloud Tasks callbacks, checking the task's Google ID token instead of a session;
│   │   │                      packages settings/ (doh, promo_uplifts) and scenario/ (building_blocks,
│   │   │                      promotions, tier0_breakdown) mount one sub-router per kind from __init__.py
│   │   ├── schemas/           Pydantic v2 request models: catalog (_Base, normalise_name, clean_customer_name),
│   │   │                      promotions, inventory, uploads, notifications, sellout (BUSINESS_COLUMNS =
│   │   │                      TARGET_SCHEMA), settings/{doh,promo_uplifts}, scenario/{building_blocks,promotions}
│   │   └── services/          All logic + all external I/O; never imports fastapi. Grouped by domain in §2.
│   │                          Sub-packages settings/ and scenario/ each have a common.py (shared engines,
│   │                          errors)
│   ├── migrations/            Numbered Cloud SQL DDL (001_… → 021_…), applied by hand in order
│   ├── scripts/               Out-of-band jobs: refresh_forecast, eval_mapping, install_reference_contracts,
│   │                          historical/promotion imports and repairs, pipeline checks, rebuild_promo_calc,
│   │                          backtest_tier0_promotions
│   ├── tests/                 pytest, one file per service/router, fakes for clients, conftest.py synthetic
│   │                          files; fixtures/retailer_samples/ is git-ignored (golden tests skip without it)
│   ├── pytest.ini             pythonpath=. testpaths=tests
│   ├── requirements.txt       Every runtime dependency, with a reason comment where non-obvious (CI installs
│   │                          pytest on top)
│   ├── .env.backend           (gitignored) local settings -- see §4
│   └── gcp-key.json           (gitignored) service-account key
│
└── frontend/aireos/           Next.js 16.3 App Router, React 19.2, JavaScript -- run: npm run dev (:3000)
    ├── app/
    │   ├── layout.js          Root layout: fonts, globals.css, UploadProvider (uploads outlive the page),
    │   │                      AssistantWidget (the floating assistant on every page)
    │   ├── page.js            Redirects / to /dashboard (proxy.js has already sent signed-out users to /login)
    │   ├── globals.css        Tailwind v4 + shadcn tokens + "AIRE brand kit" CSS vars + .dark
    │   ├── <route>/page.js    One folder per page: login, dashboard, upload, mappings (+ [id] review),
    │   │                      customers, skus, promotions, inventory, forecast, scenario, doh,
    │   │                      promo-uplift-settings, testing (UI kit gallery). page.js files stay server
    │   │                      components when they only compose a client view
    │   ├── config/            App constants: transitions.js (card cascade timing/selector), upload.js
    │   ├── components/        One folder per feature (assistant, auth, customers, dashboard, forecast,
    │   │                      inventory, landing, layout, mappings, promotions, scenario, settings, skus,
    │   │                      upload) + ui/ -- see "UI kit" below
    │   ├── services/          One <domain>Api.js per backend domain; promotionsApi.js owns request() and
    │   │                      parseApiError() (the shared fetch wrapper); uploadApi.js uses XHR for progress
    │   └── utils/             Pure, React-free helpers, one file per concern (promotionForm.js is the model);
    │                          tested by tests/*.test.mjs
    ├── hooks/                 use<Thing>.js, one hook per file, { data, loading, error } (cancel-flag pattern)
    ├── lib/                   cn() (utils.js), formatDate/formatDateRange (Singapore time display),
    │                          singaporeTime (singaporeToday), cardCascade
    ├── tests/                 node --test over *.test.mjs for pure app/utils helpers (no packages)
    ├── public/                Static assets
    ├── proxy.js               Optimistic route guard: missing session cookie → /login
    ├── CONTRIBUTING.md        Frontend UI conventions (primitives, tokens, cn(), lucide) -- binding
    ├── components.json        shadcn: style base-nova, rsc true, tsx false
    ├── jsconfig.json          @/components/* → app/components/*, @/* → ./*
    ├── next.config.mjs        loads .env.frontend; reactCompiler: true; standalone output; /api rewrite
    ├── Dockerfile             Cloud Run web image (Next standalone)
    └── .env.frontend          (gitignored, required) NEXT_PUBLIC_API_URL -- see §4
```

**UI kit (`app/components/ui/`).** Build new controls on these; `app/testing` shows them. shadcn
primitives (button, card, dialog, dropdown-menu, input, popover, switch, tabs, tooltip, chart,
calendar, skeleton) plus the team kits:
- **Dropdowns:** `Dropdown` (the one shell) → `SelectDropdown`, `MultiSelectDropdown`, `MonthDropdown`
  (on `MonthGrid`). Build new pickers on these, not on a raw Popover.
- **Dates:** `DatePicker`, `RangeDatePicker`, `DateRangePicker` (older typed pair), `DateRangeControl`,
  `MonthRangeCalendar` (helpers in `utils/datePicker.js`).
- **Toggles:** `SegmentedControl`, `LineToggle`, `ToggleButton`, `ToggleField`.
- **Tables:** `DataTable` → `TableGrid` (+ `SortHeader`, `TableSearch`, `TablePagination`,
  `TableSkeleton`), `TableRow`, `ExpandableRow`, `RowActions`, `StatusPill`/`StatusBadge`, `MobileRecordCard`
  in a `RecordCardList`, `HeaderCheckboxFilter` (a TableGrid column's `filter` draws it in that header: the
  Month filter on Inventory and Forecast); hooks `useExpandedRows`, `useConfirmAction` + `ConfirmDialog`.
  Rows animate as the data changes (`ui/rowMotion.js`, timing `TABLE_ROWS` in `config/transitions.js`): list a
  TableGrid's rows as `TableRow`/`ExpandableRow` and phone cards in `RecordCardList`, or they just snap.
- **Filters:** `FilterBar` holding `FilterSelect` / `MultiSelectDropdown` / `PriceRangeFilter`
  (closed look from `filterControl.js`).
- **Loading:** `PageSkeleton` + `CardSkeleton`, `ChartSkeletonFrame` → `BarChartSkeleton` /
  `LineChartSkeleton`, `ChartLoading`; gate first-load skeletons with `hooks/useDelayedLoading`.
- **Motion and feedback:** `TabTransition` (+ layout `PageTransition`, both via `lib/cardCascade`),
  `Toast` (+ `useToast`), `ChartZoomButton` (+ `useChartZoom`), `ComparisonFigures`, `InfoTooltip`,
  `LastUpdatedStamp`, `RefreshButton`, `Disclosure`, `BackLink`; shared class strings in
  `formStyles.js` and `popupShadow.js`.

Key dependencies: `@base-ui/react`, `shadcn` + `@shadcn/react`, `class-variance-authority`, `clsx`, `tailwind-merge`,
`lucide-react` (the only icon library), `motion` (`motion/react`, the only animation library),
`recharts`, `react-day-picker` + `date-fns` (behind `ui/calendar`), `tw-animate-css`,
`babel-plugin-react-compiler`. No frontend test framework is installed: `npm run lint` and `npm test`
(Node's built-in runner over `tests/*.test.mjs`) are the checks, and CI runs both.

---

## 2. Domains and their backing stores

| Domain | Router | Service(s) | Storage | Frontend entry |
| --- | --- | --- | --- | --- |
| Authentication | `auth.py` | `auth_service`, shared `app.auth.require_user` dependency | Google Workspace OIDC; signed HTTP-only `aireos_session` cookie (no application password store) | `app/login`, root `proxy.js` |
| Upload & mapping | `uploads.py`, `mappings.py` | Generation: `layout_detection`, `column_profile`, `generate_mapping`, `mapping_prompt`, `mapping_contract`, `mapping_checks`, `mapping_view`. Transformation: `sellout_ingestion`, `apply_contract`, `validation_service`; rollback: `ingestion_service` | **GCS** bucket: `uploads/` files, `mappings/pending/<fp>.json`, `mappings/confirmed/<fp>.json`, `mappings/history/<fp>/v<n>.json`. **Cloud SQL**: `skus` read-only during mapping checks; `ingestion_runs` + append-only `sellout_versions` audit transformed uploads and restore prior `sellout` values | `app/upload`, `app/mappings`, `services/mappingApi.js` |
| Sales dashboard | `sales.py` | `sellout_service` | **Cloud SQL Postgres**: `sellout` (the source of truth -- every upload writes here first; `retailer_id`/`store_code`/`sku` rows, `period_type` `week` or `month`), joined to `retailers`/`stores`/`skus` for names (retailer name = `{customer}_{offline|online}`). A retailer+calendar-month with monthly-granularity rows uses only those (never both, see `EFFECTIVE_SELLOUT_CTE`); `granularity='week'` summary views read genuine weekly rows only. No more BigQuery/Datastream replication lag -- reads are real-time | `app/dashboard`, `hooks/use*.js`, `services/salesApi.js` |
| Catalog | `catalog.py` | `catalog_service`, `customer_service` | **Cloud SQL Postgres**: `customers`, `customer_retailers`, `retailers`, `stores`, `skus`, `sku_history`. Retailer names are lowercase slugs; customer names keep the capitals they were typed with (`FairPrice`, `Sheng_Shiong`); both unique case-insensitively. A retailer with stores, or a customer with any such retailer or `inventory_metrics` rows, is `in_use` and can't be deleted (nor, for a retailer, renamed). A customer can always be renamed: everything links to it by id, its retailers keep their slug names, and the dashboard labels a retailer family with its owning customer's name (`sellout_service._customer_label`). `skus` keeps one stable foreign-key master row per code; `sku_history` stores its timestamped created/updated/archived versions. Historical price reads resolve the version effective on the requested date. | `app/customers`, `app/skus`, `services/catalogApi.js`; `services/promotionsApi.js` (getRetailers/getStores/getSkuRanges) |
| Inventory | `inventory.py` | `inventory_service`, `inventory_calc` (pure), `sellout_units`, `forecast_units`, `sell_in_upload` (pure: reads the sell-in tracker workbook), `sell_in_snapshots` | **Cloud SQL Postgres**: `customers`, `customer_retailers`, `inventory_metrics` (long format; app writes carry `data_source='manual_entry'`; only sell-in, a first-month opening and building blocks (stock used outside sell-out) are read; workbook rows are never changed), `doh_settings` (read via `settings/doh.fetch_versions`; closed months use the version in effect at month end, the latest month, at-risk list and sell-in plan use the current one), `sellout` (sell-out, via `sellout_units`/`sellout_service`'s effective-sellout view, same monthly-preferred-over-weekly rule as the dashboard); **BigQuery** (read-only): the forecast table. `sell_in_plan_snapshots` (one saved plan per customer per month, written when a forecast refresh retrains: the chart's "Sell-in Forecast (Previous)"). Ending stock, DOH and the plan are computed, never stored | `app/inventory`, `services/inventoryApi.js` |
| Scenario builder | `scenario/building_blocks.py` (`/api/scenario/building-blocks`), `scenario/tier0_breakdown.py` (`/api/scenario/tier0-breakdown`, read-only) | `scenario/building_blocks`, `scenario/common`, `scenario/tier0_split` (pure: Tier 0 = ½ same month last year + ½ 3-month run-rate, split into the ordinary-month baseline at the anchor and the promotions its source months carried, plus the official promotions planned; BigQuery's Tier 0 is never changed), `scenario/tier0_breakdown` (reads `fc_training_input` + promotions, `promo_moment_calc`, anchors and discounts for it; `scripts/backtest_tier0_promotions.py` scores the same maths), `scenario/block_effects` (pure) | **Cloud SQL Postgres**: `scenario_building_blocks` (what-if uplifts stored as entered: `uplift_mode` `pct` = % on Current each month, `units` = whole units over the whole range; a negative value is a decrease (a flood, a store closing; migration `014_scenario_building_blocks_decrease.sql`), and the Simulated line is floored at 0 per customer x SKU x month (`scenarioEngine.simulate`); `is_active` decides whether a block counts; a block covers several customers (migration `022_scenario_items_several_customers.sql`): `customer_ids` INTEGER[], NULL = every customer, sent and returned as `customer_names` (none = all; the editor's `MultiSelectDropdown`, labelled by `retailerLabel.customersLabel`), `customer_id` filled only for exactly one (growth always; keeps its unique index and ON DELETE CASCADE), and `customer_service.delete_customer` takes a deleted customer out of every list (`scenario/common.remove_customer`); the engine matches with `scenarioEngine.itemCustomers` / `coversCustomer`, and a units block gives each customer it covers the full number of units; each customer x SKU range can be switched off on its own while the block stays one entry (`excluded_pairs` JSONB of `{customer_id, sku_range}`, migration `023_scenario_items_excluded_pairs.sql`; API `excluded_pairs` by name; engine `pairExcluded` / `itemPairs` / `withPairSwitched`, the blocks table's opened row switches them and saves at once; the inventory overlay skips them as `excluded_skus` in `block_effects`); `sku` NULL = all SKUs; blocks follow SKU ranges, several at once (migration `017_scenario_blocks_by_sku_range.sql`): `sku_ranges` TEXT[] = every SKU of those ranges, NULL = All SKU ranges (`fetch_blocks_for_customer` resolves it to `range_skus` for `block_effects`), `sku` alone only on blocks saved before ranges, never both; editors pick ranges with `scenario/SkuRangePicker` (multi-select, none = All SKU ranges); `kind` `block` or `growth` (migrations `016`/`017`): growth is the budget's year-on-year growth, next year = Tier 0 x (1 + g), stored as a `pct` block on every SKU of one customer (`sku_ranges` and `sku` NULL) from January to December, at most one per customer x year (migration `024_scenario_growth_per_customer.sql`; a second one is 409 `GrowthBlockExistsError`; edited one row per year in `scenario/GrowthControl`), applied like any `pct` block. The Scenario builder filters by SKU range: `GET /api/forecast?sku_range=` (`bigquery.resolve_forecast_scope(sku_range=)` → SKU codes; rows carry `sku_range`; `/options` returns `sku_ranges`). Scenario promotions follow ranges too (`skuRanges`, several or none = All SKU ranges), and customers like blocks (`customers` / `customer_names`, none = every customer; `excluded_pairs` switched in the promotion editor through the shared `scenario/ItemPairs`); each customer x SKU takes its own customer's uplift (`effectiveUpliftPct(promotion, customer, product, month)`), the values copied in are kept per customer (`references` / `references_by_customer` keyed by customer id, migration `025_scenario_promotions_references_by_customer.sql`; the single `reference_*` columns carry the first customer's), the slider shows the spread and an override is one value for all, and a voucher edit is one value for all (`voucherChange`). They are saved in `scenario_promotions` (migration `018_create_scenario_promotions.sql`, `/api/scenario/promotions`, same scope and on/off rules as blocks, uplifts copied in when saved) and never move a promo anchor, and values come from `promo_uplift_settings` / `promo_anchor_settings` through `resolve_uplifts` (`range_uplifts`, `range_anchors`, `product_ranges`: one range takes its range's value; several or all take the customer's plus each product's own within them). Uplifts are never typed on Promotion Uplift Settings (Phase 3 removed the typed values, overrides and reset; their rows stay in the history, unused): they are worked out (`promo_uplift_calc`), and only a mechanic's discount (`PUT /promo-uplifts/mechanics/{key}`) and the anchors are edited there; an uplift is edited for one scenario only, on a Scenario-builder promotion. SKU-level rows saved before stay in the history but never apply (`promo_uplifts._applies`). Tier 0 itself has no growth factor since 8 Nov 2026: `0.5 x same month last year + 0.5 x 3-month run-rate` (`pl_forecast`, `bigquery/views/010_…`)). Read by the Scenario builder's Simulated line, always on Tier 0 (the page opens on next year), the delta worked out on the client (`scenarioEngine.js`), and by the sell-in plan chart's building blocks overlay, where blocks picked by hand are applied by the backend with the same rules (`scenario/block_effects.py`) and the plan is worked out again on them -- a what-if line only: the Current forecast, the plan and its table, the saved sell-in snapshots and the Dashboard never include them. In units only -- the Scenario builder never predicts revenue, since a discount's price effect isn't modelled. Not the same as inventory's `sell_out_building_blocks` (confirmed blocks that count as actuals) | `app/scenario`, `services/scenarioBuildingBlocksApi.js`, `services/scenarioTier0BreakdownApi.js` + `hooks/useTier0Breakdown.js`, `hooks/usePromoAnchors.js`; pure helpers in `app/utils/`: `scenarioEngine` (the Simulated line, `chartView`), `scenarioTier0Split` (the split per cell, used only within 1 carton of its Tier 0; official promotions in place of the carried block; scenario promotions replace it where nothing official is planned, else add on top; `carriedOffCells`; `monthSplit`, `planStatus`, `bigChange` > 35%), `scenarioMilestones` (pure: building blocks in months with actuals are milestones, worked back from the actual -- a -20% block on 2,000 is 2,500 without it; units as entered per customer; marked on the Actual line, listed in the hover card and the Breakdown tab's "What Actual is made of", never moving a line; scenario promotions stay forecast-only), `scenarioComposition` (the chart's shaded layers, hatched decreases, hover breakdown), `scenarioPlan` (Monthly plan rows: `parts`, `promotionLines` with mechanics, `planStatus`), `scenarioGrowth`, `scenarioBreakdown`, `scenarioLiveUplifts`, `dateRange.nextYearDateRange`; components `scenario/FrozenBaselinePanel` (Breakdown tab: growth + what Simulated is made of over the months on the chart, `scenarioComposition.breakdownTotals`; no switches, everything switched on counts), `MonthlyPlanTable` → `Tier0Details` (an opened month), both showing mechanics with `MechanicPills` (same month last year / recent months / planned) |
| Scenario promotions | `scenario/promotions.py` (`/api/scenario/promotions`) | `scenario/promotions`, `scenario/common` | **Cloud SQL Postgres**: `scenario_promotions` -- planned promotions that only move the Scenario builder's Simulated line, saved and toggled like building blocks; uplifts stored as copied from Promotion Uplift Settings (a later settings change never moves a saved one). Never touches the real `promotions` table, the forecast, Inventory or the Dashboard; the effect is applied on the client (`utils/scenarioPromotions.js`) | `app/scenario`, `services/scenarioPromotionsApi.js` |
| Settings (DOH) | `settings/doh.py` | `settings/doh`, `settings/common` | **Cloud SQL Postgres**: `doh_settings` (append-only: a change is an INSERT only when min/target/max differ from the newest row; newest by `updated_at DESC, setting_id DESC`; never UPDATE/DELETE, except that a new customer gets a global-default row; `customer_id` is ON DELETE CASCADE, so deleting a customer deletes its rows and DOH settings never block it), view `current_settings` (one row per customer), `customers.doh_alert_enabled` / `doh_alert_updated_at` (in-place toggle, no version). Also read by the inventory DOH calculations (`fetch_versions`, `thresholds_on`, `current_thresholds`) | `app/doh`, `services/settingsApi.js` |
| Settings (promotion uplifts) | `settings/promo_uplifts.py` (`/api/settings/promo-uplifts`) | `settings/promo_uplifts`, `settings/promo_uplift_rules` (pure), `settings/promo_moments`, `settings/promo_moment_rules` (pure), `settings/promo_anchor_versions` (pure: anchor versions by month (`version_lookup`), planned moments from official future promotions, projected anchor changes, moments measured against their own month's version, the uplift chosen per version: latest 3 → converted earlier versions → placeholder), `settings/promo_recalc` (one customer's moments, uplifts and projected anchors into the calc tables; `process_pending` runs the queue: Cloud Task `/internal/promo/recalc`, `POST /recalculate`, `scripts/rebuild_promo_calc.py`), `settings/promo_recalc_events` (records recalculation requests in the saving transaction while `PROMO_RECALC_ENABLED` is on; one Cloud Task per 5-minute window), `settings/promo_uplift_calc` (the page's uplift rows, `GET /calculated`) | **Cloud SQL Postgres**: `promo_uplift_settings` (uplift per mechanic) and `promo_anchor_settings` (the ordinary-month mechanic uplifts are measured from), per customer x SKU range / per customer / all customers; append-only like `doh_settings` (migrations 012, 013; anchors and mechanic discounts apply from a month: 019, 021). Moments, uplifts and projected anchors are worked out into calc tables (`promo_moment_calc`, `promo_uplift_calc`; migration 020) from `sellout` + `promotions`, and read from there | `app/promo-uplift-settings`, `services/promoUpliftsApi.js` |
| Promotions | `promotions.py` | `promotion_service` (+ `catalog_service` seams) | **Cloud SQL Postgres**: `promotions`, `promotion_stores`, `promotion_skus`; enum `promo_type_enum`; trigger `trg_promotions_updated_at` | `app/promotions`, `services/promotionsApi.js` |
| Forecast (P&L) | `forecast.py` (`/api/forecast`, read-only; writes are out of band via `scripts/refresh_forecast.py` or the Forecast refresh row below) | `pl_forecast` (pure), `forecast_service`, `bigquery` (forecast reads), `forecast_cache`, `forecast_summary` (the assistant's view of the same numbers), `catalog_service` (product prices) | **BigQuery** (`BQ_FORECAST_DATASET`, default `aireos_forecast_validation_sg`, read-only; names from `BQ_CDC_DATASET`): model learns from `v_sales_enriched` (weekly), page Actual line reads `v_customer_monthly_sales`; refresh MERGEs into `BQ_FORECAST_TABLE`. **Cloud SQL Postgres**: `skus.price` prices sell-out revenue | `app/forecast` |
| Forecast refresh | `internal_forecast.py` (`/internal/forecast`, Cloud Tasks callback; checks a Google ID token instead of a session) | `forecast_refresh_events` (records input changes and wakes the worker), `forecast_refresh_worker` (debounces, waits for CDC, runs the BigQuery forecast procedure), `forecast_notifications`, `sell_in_snapshots` | **Cloud SQL Postgres**: `forecast_refresh_requests` (migrations 007, 008); **Cloud Tasks** (`FORECAST_REFRESH_*` settings, off unless `FORECAST_REFRESH_ENABLED`); **BigQuery** forecast procedure + run log | Forecast page "updating" badge (`/api/forecast/refresh-status`) |
| Notifications | `notifications.py` (`/api/notifications`: list, unread count, mark-read, `/stream`) | `notification_service` (one shared feed, no per-user state), `forecast_notifications` (payload shape); `app/notification_stream.py` | **Cloud SQL Postgres**: `notifications` (migrations 003, 004, 005, 007, 016); Postgres `LISTEN/NOTIFY` (asyncpg) pushed to open tabs as server-sent events. Written by inventory (low stock), forecast refreshes and the forecast script, mapping and rollback events, and a retired AI model (`ai_models`) | `components/layout/NotificationBell` / `NotificationPanel`, `hooks/useNotifications.js`, `services/notificationsApi.js` |
| AI mapping | (inside uploads, `mappings.py`) | `generate_mapping` | **Gemini on Vertex AI** (`google-genai`, `MAPPING_MODEL` default `gemini-3.8-flash`, `MAPPING_VERTEX_LOCATION` default `global`, signed in as the service account, no API key). Pending proposals record `provider` + `model` (ones made before the move to Gemini say `anthropic`); `scripts/eval_mapping.py` scores proposals against `reference_contracts` | — |
| Assistant | `assistant.py` (`/api/assistant`) | `assistant` | **Gemini on Vertex AI** (`GEMINI_ASSISTANT_MODEL`, default `gemini-3.8-flash`; `GCP_VERTEX_LOCATION`, default `global`), both set in `config.py` | floating widget (`components/assistant`, mounted in the root layout), `hooks/useAssistant.js` |
| AI model retirement | `ai_models.py` (`/api/ai-models/status`) | `ai_models` (raised by `generate_mapping._ask_gemini` and `assistant.ask`/`generate_digest`) | No store of its own: a Vertex AI 404 NOT_FOUND on the configured model is `ModelUnavailableError` (503 from the assistant; upload mapping falls back to a blank proposal to fill in by hand, `generate_mapping.blank_mapping_contract`) and a `model_outdated` notification (one unread per model, migration 016). The status reads those rows back, so a model stays unavailable until its setting names a different one. No background check yet: found only when a call fails | `components/layout/ModelUnavailableNotice` (Nomenclatures header, an amber warning: mapping still works by hand), `assistant/AssistantUnavailable` (a red error that replaces the chat error and disables the question box), `hooks/useAiModelStatus.js`, `services/aiModelsApi.js`, `utils/aiModels.js` |

Budget planning (C/D): Scenario builder has separate `scenario` / `budget` item scopes (migration 026), with one growth per plan x customer x year. `scenario/initial_breakdown.py` reconstructs Initial at `aire_forecasting_initial_meta.data_cutoff`, rebuilding historical moments without later sales, reconciling every cell to published Initial and retaining source anchors. `tier0-breakdown?basis=initial&year=` returns it; unavailable origins/history block Budget preview and locking. Growth and blocks apply to Initial; budget promotions replace its carried effects for their covered month share. `scenario/budgets.py` locks a full year through pure `budget_calc.py`, keeping that split in the snapshot inputs; `budget_snapshots` and `budget_snapshot_rows` retain every lock version and identity. Latest locked units feed Forecast's Budget comparison (`useBudgets`, `budgetPlanning.js`) and Inventory's sell-in outlook (`sellout_for_customer` plus the existing sell-in planner). Current plans and manual scenario overlays exclude budget entries. See `docs/budget-planning.md` for API and deployment details.

Scenario saved-item UI: `BlockTable` and `PromotionTable` list all saved entries in their mode, independently of chart filters and active status; table search/paging narrow the list, while gains remain chart-scoped. `useScenarioPromotionEditor` shares save/toggle/clash/delete actions between the saved table and sidebar; drafts/current edits stay in `PromotionsSection` and `PromotionList`. `scenarioSavedItems` merges refresh results while retaining drafts, edits and stable row IDs; item hooks ignore reads superseded by writes. Hover/focus on a `FrozenBaselinePanel` part passes a spotlight to `ForecastChart`; `scenarioComposition` maps each part's positive and source-specific negative bands to opacity changes only, keeping stack positions and model values unchanged.

Invariants that cross domains:
- Mapping never writes to BigQuery. Ingestion into BigQuery is out of band.
- Promotion writes never insert/update `skus`, `stores`, `retailers` **except** through the
  `get_or_create_retailers/stores` seams (a promotion may name a new store as free text).
- `TARGET_SCHEMA` is `schemas/sellout.BUSINESS_COLUMNS`, defined once.
- A mapping is strictly a contract: instructions written by mapping generation and carried out by the
  transformation. No business rule lives outside the contract -- the monthly roll-up is the contract's `aggregate`,
  where the data sits is its `layout`, and a retailer's product codes become master SKUs through the `sku` field's
  `value_map` (the code table). A product code that is not a master SKU fails the contract's checks and blocks
  approval until the code table is fixed or the product is added to the SKU master.
- A store is sold through one of its customer's retailers (`{customer}_offline` or `{customer}_online`), never both.
  `mapping_checks.check_store_channels` runs on the transformed rows in the mapping test and on approval (422), and
  `sellout_service.load_clean_rows` refuses a file whose rows split a store, or that sends a store to a different
  retailer than its stored sales (`StoreChannelError`, the load dry run says so first). A reload with a corrected
  rule moves its own stores: its earlier rows are deleted before the check. Rows with no store code are
  customer-level totals and are exempt.
- There is one contract format. The transformation (`sellout_ingestion` → `apply_contract`) executes its layout,
  field, melt, transform and aggregate instructions. "Version" means only a mapping's approval count: each approval
  stores the envelope with `version` + 1 and archives the one it replaces under `mappings/history/<fp>/v<n>.json`;
  uploads record the `mapping_version` they were loaded with, which drives `reload_available`.
- Time: the backend stores and returns instants in UTC (TIMESTAMPTZ, Postgres sessions pinned to UTC
  in `sql.py`, ISO strings with `Z`/`+00:00`) and takes "today" as the UTC day, never `date.today()`.
  The frontend shows every time in Singapore time through `lib/formatDate.js`, and uses
  `singaporeToday()` instead of `new Date()` for "today / this month / this year". Bare `YYYY-MM-DD`
  dates are calendar dates and are never shifted. (Exceptions by design: DOH month boundaries in
  `settings/doh.py`, the date printed on assistant reports, the assistant's "today" (so "this month" /
  "next month" in a question mean the Singapore month), `forecast_summary.py`'s month-to-date
  check and the promotion overview's status (`promotion_service._STATUS_SQL`, as `promotionStatus` shows
  it) are Singapore days.)

---

## 3. Data flow and communication patterns

### 3.1 Transport

- Browser → FastAPI over `fetch`, JSON bodies, base URL `NEXT_PUBLIC_API_URL`
  (`http://localhost:8000` in dev). Protected requests include the signed HTTP-only session cookie;
  every page that loads application data is a `'use client'` tree.
- CORS is always an explicit list (`config.CORS_ALLOWED_ORIGINS`, default localhost:3000) with
  credentials allowed; with SSO enabled `main.py` adds `AUTH_FRONTEND_URL` if it is missing.
  Deployed builds avoid CORS altogether: `next.config.mjs` forwards `/api/*` to `BACKEND_API_URL`.
- Uploads are `multipart/form-data` with field name `files` (many) and optional `force`.
- Errors: FastAPI returns `{ "detail": string | [{loc,msg,...}] }`. The frontend
  `parseApiError()` flattens both to one message and the thrown `Error` carries `.status` and
  `.data`.

### 3.2 Request lifecycle (typical read)

```
Component/page ──► hook (hooks/use*.js) or *Api.js function
                   └─► fetch(`${NEXT_PUBLIC_API_URL}/api/...?params`)
                        └─► app/routers/*.py   parse query args / Pydantic body
                             └─► app/services/*.py   validate enums, build SQL, call client singleton
                                  └─► BigQuery | Cloud SQL | GCS | Vertex AI (Gemini)
                             ◄─── dict / list[dict] / DataFrame.to_dict
                        ◄─── JSON (200) or {detail} (4xx/5xx)
                   ◄─── { data, loading, error } state
```

### 3.3 Three concrete flows

**Upload → mapping → review** (`POST /api/uploads`)
0. On drop, each file is sent to `POST /api/uploads/check` (`upload_check.check_file`): read-only, it reports
   whether the file can be uploaded, the mapping it would get (`generate_mapping.preview_mapping`) and any earlier
   upload it duplicates, so the upload page sorts files into Ready / Needs attention before Upload is pressed.
1. `UploadProvider` (`components/upload`, mounted in the root layout) posts each file through
   `uploadApi.uploadFile` (XHR, for progress). Router reads every stream once, `asyncio.to_thread(storage.upload_many)`
   (duplicate-filename check unless `force`).
2. Per file, concurrently (`asyncio.gather` → `to_thread(resolve_and_apply_mapping)`):
   `generate_mapping.resolve_mapping`: `layout_detection.read_table` → fingerprint the header templates →
   `mappings/confirmed/<fp>.json` → `status: "mapped"`; the contract
   runs through `sellout_ingestion.process_confirmed_upload` -- unless `REQUIRE_LOAD_CONFIRMATION` is on, when the
   file is left `ready_to_load` for step 4 instead. Else Gemini proposes a contract (structured output,
   schema built from this file's headers, SKU master listed),
   `mapping_checks` checks it statically against the file and the SKU master, failures go back for
   up to 2 repairs, and the result is stored in `mappings/pending/` with its checks and the file's product codes →
   `status: "pending_confirmation"`.
3. The review page loads `GET /api/mappings/{fp}` (packet from `mapping_view`: one rule per target field, the
   checks, the product codes and the SKU master), the user edits **rules** and the product-code table,
   `POST /api/mappings/{fp}/preview` re-runs the checks, and `POST .../{fp}/confirm` rebuilds + re-validates and
   re-checks the contract (unknown product codes → 422), records the reviewer's diff against the proposal, archives
   any previous version under `mappings/history/` and stores it under `confirmed/`. `DELETE .../{fp}/pending` discards
   the proposal **and the uploads still waiting on it** (`upload_loading.discard_proposal`; nothing was loaded from them).
   The page is numbered steps (customer → fields → product codes → checks) beside a "What's left" list
   (`utils/reviewChecklist.js`). A mapping belongs to a **customer**: confirm requires `customer_id` (stored as
   `customer_id`/`customer_name`, and as `vendor` for upload history) and 422s while any retailer the contract writes
   to (`mapping_contract.retailer_outputs`) is not that customer's -- otherwise uploads would create retailers no
   customer owns and the dashboard would never show their sales. A new customer is created from the page with its
   `<name>_offline`/`<name>_online` retailers in one transaction (`CustomerCreate.retailer_names`).
   **Approving loads nothing.** `upload_loading.mark_uploads_after_approval` re-stamps the files behind the mapping
   (`ready_to_load`, or `reload_available` for files loaded with an older version) and confirm returns them as
   `waiting_uploads` / `outdated_uploads`.
4. Loading is a separate, confirmed step. `LoadConfirmDialog` (from the approved screen, Recent uploads, or the
   upload row when the flag is on) calls `POST /api/uploads/load/preview`, then `POST /api/uploads/load`. Each
   successful write is versioned in `ingestion_runs` / `sellout_versions`. A reload matches the prior run by unique
   GCS `source_blob`, never the user-facing filename, and removes only stale keys still owned by that run. Upload
   states are `pending_confirmation` → `ready_to_load` → `mapped`, then `reload_available` after a new mapping version.
5. A completed, versioned upload can be reversed from Recent uploads through `POST /api/uploads/rollback`.
   The rollback marks its ingestion run as rolled back and rebuilds only its affected business keys from the latest
   still-active versions in one Cloud SQL transaction. The GCS source and mapping remain as an audit trail; uploads
   from before the rollback migration have no rollback action.

**Dashboard** (`app/dashboard/page.js`)
1. `useDataFreshness` polls `/api/sales/last-updated`; a change bumps `dataVersion`, which every
   other hook lists as a dependency so data silently refreshes.
2. `useCustomerOptions` → every customer ticked during render (no cap; colours by `customer_id`).
   One customer draws the store-format chart, two or more `CustomerTrendChart`; either turns from
   bars to lines past the bar limit (`utils/chartKind.js`).
3. `useDefaultDateRange` (week) gives the latest loaded period across every ticked customer (and the
   earliest, so the Period / Compare to pickers offer only months inside the data, `utils/dataBounds.js`);
   while a new selection is read it keeps the last bounds with `updating` true. Every Period preset (whole
   months — the dashboard works in monthly figures) is built from its month on the client
   (`dateRangePresets.js`), and `comparisonSetup` derives the
   "Compare to" baseline range (none by default). `useDashboardSummary` is called for this
   period and, while comparing, for the baseline; it waits for both dates and derives `loading` from
   the filters its figures were fetched for. Hooks take
   `{ customer, sku, store, startDate, endDate, mode, dataVersion }` and hit `/api/sales/*`;
   each maps to one `sellout_service.get_*` function that builds a parameterised Cloud SQL query.
4. The chart opens By month; By week is a drill-down, disabled when no month in the range has
   weekly rows for any ticked customer (`useMonthlyOnly` with `customers`). Both sides of a comparison are read at the chart's
   granularity — monthly totals by month, weekly rows by week — so they compare the same kind
   of data; `alignComparisonBuckets` pairs them on the client.
5. While a comparison is on, `usePriceMix` fetches per-SKU sales for both periods
   (`/api/sales/skus`) so the Comparison panel can split the average-price change.

**Promotions** (`app/promotions/page.js`)
1. On mount: `getRetailers`, `getStores`, `getSkuRanges` (all in `promotionsApi.js`). The overview
   (`PromotionList`) reads one page at a time, `GET /api/promotions` through `usePromotionPage` and its
   dropdowns through `usePromotionFilterOptions`; the backend filters, searches, sorts and pages
   (`promotion_service.list_promotion_page`) and hides older copies of a promotion (same event, same
   stores) without changing the rows. The page bumps a refresh key after a save or delete.
2. Form state lives in one `form` object; `validatePromotionForm` → `buildPromotionPayload`
   produces `{ stores:[{retailer, store_name, store_code, store_format}], period_start,
   period_end, period_label, promo_type, promotion_mechanic, voucher, skus:[{sku, sku_range}] }`.
3. `POST /api/promotions` → Pydantic `PromotionCreate` (date order, unique stores, unique skus)
   → `promotion_service.create_promotion` in **one transaction**: leave out stores already running the
   event (same period, type, trimmed mechanic; returned as `skipped_stores`, 409 when that is every store) →
   insert `promotions` →
   `get_or_create_retailers/stores` for the whole batch → insert `promotion_stores` → resolve `sku_range` to
   catalog `skus` → upsert `promotion_skus` → `_fetch_promotion` returns the row with nested
   `stores[]` / `skus[]` via `json_agg`.
4. `PUT` replaces link rows wholesale (409 if a store already runs the event); `DELETE` removes links
   then the promotion.
   The response `promotion` object is what `formFromPromotion` reads back for edit.

### 3.4 Contracts that must stay in sync across the stack

| Backend | Frontend |
| --- | --- |
| `PromoType` Literal in `schemas/promotions.py` and `promo_type_enum` in Postgres | `PROMO_TYPES` in `app/utils/promotionForm.js` |
| `PromotionBase` field names | `buildPromotionPayload` / `formFromPromotion` |
| `_PROMOTION_COLUMNS` (nested `stores`, `skus`) | `PromotionList.jsx`, `promotionOverview.js` |
| `GET /api/promotions` (`promotion_service.list_promotion_page`: `limit` 1-100, `offset`, `search`, `sort` `PROMOTION_SORT_FIELDS`, `direction`, filters `retailer`/`store`/`period`/`promo_type`/`mechanic`/`status` `PROMOTION_STATUSES`; returns `promotions`, `total`, `unfiltered_total`, `limit`, `offset`; search labels `_PROMO_TYPE_LABELS` / `_STATUS_LABELS`), `GET /api/promotions/filter-options`, create `skipped_stores` and the 409 `PromotionClashError` | `promotionsApi.getPromotionPage` / `getPromotionFilterOptions` / `createPromotion`, `hooks/usePromotionPage.js`, `hooks/usePromotionFilterOptions.js`, `PromotionList.jsx` (`EMPTY_FILTERS`), `promotions/columns.js` (`sortField`s), `PROMO_TYPES` / `promoTypeLabel` and `promotionStatus` (the labels and status rule search and filter by) |
| `sales.py` query-param names (`start_date`, `end_date`, `granularity`, `customer`, `customers` (comma-separated, on `default-date-range` / `monthly-only`), `store`, `sku` …) | `URLSearchParams` keys in `hooks/*.js` and `services/salesApi.js` |
| `sellout_service.get_customer_options` (`/api/sales/customer-options`: `value` slug, `label`, `customer_id` through `customer_retailers`, or null) | `useCustomerOptions.js`, `storeFormats.customerColorOrder` (colours matched by `customer_id`, not name), `CustomerSelector.jsx` |
| `sellout_service.get_default_date_range` (`customers` → latest / earliest across them: `start`, `end`, `earliest_start`, `latest_week_start`) | `useDefaultDateRange.js`, `utils/dataBounds.js` (`isWithinData`), `MonthRangeCalendar.jsx`, `DateRangeControl.jsx`, `CompareControl.jsx`, `app/dashboard/page.js` (saved Period / Compare to fall back when outside) |
| `sellout_service.get_customer_totals` per-channel `has_data` (rows loaded for the period) | `RevenueSummaryCards.jsx` ("No sales data"), `SkuRanking.jsx` customer rows ("No data") |
| `sellout_service.get_customer_trends` (`/api/sales/customer-trends`: `customers[]` with `offline`/`online` period lists, `has_*`; no cap on customers) | `salesApi.getCustomerTrends`, `useCustomerTrends.js`, `utils/customerTrend.js`, `utils/chartKind.js` (`MAX_BARS_DESKTOP`/`MAX_BARS_MOBILE`), `CustomerTrendChart.jsx`, `CustomerSelector.jsx` |
| `sellout_service` estimated part of revenue: `estimated_revenue` (dashboard summary rows, customer totals), `estimated_value` (SKU ranking), from the `revenue_estimated` row flag | `utils/estimatedRevenue.js`, `EstMark.jsx` (top right of each `RevenueSummaryCards` tile, beside `SkuRanking` values; `TrendChart` tooltip) |
| `mapping_view` packet/rule keys (`targetField`, `sourceColumn`, `editable`, `status`, `field`, `meltGroup`, `options`, `description`, `requiredMissing`, `checks`) | `utils/mappingReview.js`, `components/mappings/*` |
| `mapping_checks` check shape (`id`, `level`, `passed`, `message`, `fields`, `evidence`) | `utils/mappingChecks.js`, `MappingChecks.jsx` |
| packet `skuCodes`, `masterSkus`, `instructions`; processing preview/rejection fields | `utils/skuCodeTable.js`, `SkuCodeTable.jsx`, `MappingReviewPanel.jsx`, `UploadFileRow.jsx` |
| `uploads.py` per-file `mapping.status` values (`mapped`, `ready_to_load`, `pending_confirmation`, `mapping_failed`) | `utils/uploadFlow.js` (`outcomeFromResult`) |
| upload `mapping_status` load states (`ready_to_load`, `mapped`, `reload_available`, in `upload_loading`); load preview/result keys (`preview_loads`, `load_uploads`, `sellout_ingestion.preview_confirmed_upload`); confirm `waiting_uploads`/`outdated_uploads`/`load_requires_confirmation` | `utils/uploadHistory.js`, `utils/loadPreview.js` (`LOAD_PREVIEW_FIELDS`), `LoadConfirmDialog.jsx` → `LoadFileRow.jsx` (sample rows via `OutputPreview`), `ApprovedSummary.jsx` |
| `settings/doh._settings_view` keys, `GLOBAL_DEFAULT_*_DOH` | `DohSettingsTable.jsx`, `dohSettingsForm.js` (`GLOBAL_DEFAULT_DOH`) |
| `DohThresholdsUpdate` field names | `buildDohThresholdPayload` |
| `DELETE /api/mappings/{fp}/pending` → `removed_uploads`; review packet `waitingUploads` (pending only, `upload_loading.uploads_waiting_on_proposal`) | `ConfirmDiscardDialog.jsx` (names the files), `UploadProvider.forgetMapping` (drops their `needs_review` rows), `app/mappings/page.js` (`?discarded=<n>` toast) |
| `ConfirmRequest.customer_id`; packet `customerId`, `customerName`, `sourceFilename`; `mapping_contract.retailer_outputs` | `mappingApi.confirmMapping`, `utils/mappingCustomer.js` (`retailerOutputs` mirrors it), `utils/mappingList.js` |
| packet `columnGroups` (`mapping_view.column_groups`: detected groups from `column_profile.review_column_groups`, with contract-ready `group` settings, `readings`, `meltGroupId`/`field`) and `measureFields` | `utils/mappingReview.js` (`toGroups`, `groupChoices`, `toRules`), `FieldTable.jsx`, `ColumnGroupDetails.jsx`, `UnusedColumns.jsx`. `review_column_groups` adds month-named headings for review only -- never fold them into `detect_column_groups`, which the layout fingerprint is built from |
| `CustomerCreate.retailer_names` (`customer_service._attach_retailer`: links a retailer an upload made, 409 for another customer's) | `NewCustomerDialog.jsx` |
| `customer_service.list_customers` keys (`customers[].retailers[]`, `in_use`, `unlinked_retailers`), retailer writes' `{ retailer, customer }` | `useCustomers.js`, `components/customers/*` |
| `schemas.catalog.normalise_name` slug rule, `clean_customer_name`, `in_use` rules | `customerForm.js` (`normaliseName`, `cleanCustomerName`, `*BlockReason`), `retailerLabel.customerLabel`, `mappingCustomer.customerRetailerFamily` |
| Contract vocabulary: `mapping_contract` statuses, `TRANSFORM_TYPES`, `RULE_OPS`, `MELT_KEY_TARGETS`/`LABEL_TARGETS` (melt-group `labels`; `rows_above: 0` = the headings again, so any descriptive field (`HEADING_FIELDS`) can read them), `from_layout: "stated_period"` | `utils/fieldDecision.js` (`fieldMethods`, `currentDecision`, `decisionEntry`, `withFieldDecision`), `utils/transformSteps.js` (`STEP_TYPES`, `RULE_OPS`), `FieldEditorDialog.jsx` |
| `mappings.ContractSettings` (`instructions.aggregate` on preview/confirm); packet `instructions`, `headRows`; preview `layout`, `head_rows`, `preview_error` | `useMappingEdits` (`instructionsPayload`), `FileSettings.jsx`, `FileTop.jsx`, `MappingReviewPanel.jsx`, `mappingApi.previewMapping/confirmMapping` |
| Retailer = `{customer}_online` / `{customer}_offline` (`sellout_service._retailer_for`); `mapping_contract.retailer_outputs` (incl. retailers read off headings, given `columns`/`layout`); packet `columnValues` | `utils/retailerSplit.js` (`splitDecision`, `withCustomerChannels`), `ChannelSplit.jsx`, `mappingCustomer.retailerDecision` |
| `GET /api/settings/promo-uplifts/moments` (`settings/promo_moments.list_moments`, rules in `settings/promo_moment_rules.py`; read from `promo_moment_calc`, never live sell-out): `moments[]` (`customer_name`, `sku`, `sku_range`, `month`, `mechanic_key`, `uplift_pct`, `is_baseline`, and the version measured against: `anchor_id`, `version_from`, `baseline_source` `version`/`all_time`, `baseline_months`), `calc_status` {customer_id: `calculated_at`, `pending`, `warnings`, `last_error`}, `recommendations[]` (`recommended_uplift_pct`, `moments_by_year`, `months_used`, `enough_data`), `recommend_from` | `promoUpliftSettings.js` (`momentCounts`, `formatMomentCounts`: per customer x SKU range x mechanic), `PromoUpliftTable.jsx` (Moments column), `hooks/usePromoMoments.js` |
| `settings/promo_uplifts` anchors per customer x SKU range, changed by adopting a recommendation, by an overwrite (PUT `/anchors/{customer_id}` `{mechanic_key, sku_range}`: one of the entry's `mechanic_options`, the mechanics its official whole-month promotions use with a discount, from `promo_moment_calc`; any other is 400; source `manual`, from this month; projections still apply later) or by a projection (`source` `projected`). `list_anchors` `window_months`, `recommend_from`, `fallback` (the one anchor for targets with nothing saved: `anchor_pct`, `effective_from`, `upcoming`; PUT `/anchors/default` `{anchor_pct}`, history `/anchors/default/history`), `customers[].ranges[]`: `sku_range`, `anchor_pct`, `mechanic_label`, `source` `recommended`/`manual`/`projected`/`customer`/`default`, `effective_from`, `upcoming[]` (later changes: `effective_from` + the same fields; versions apply from a month, migration `019_promo_anchor_effective_from.sql`, picked by `settings/common.in_effect`), `recommended`, `recommendation_differs`, `mechanic_options`; history rows `effective_from`, `is_current`, `is_upcoming`; POST `/adopt` takes `sku_range`, history `?sku_range=`; `seed_anchors`. Mechanic discounts: PUT `/mechanics/{mechanic_key}` `{effective_discount_pct, note}` (a new all-customers version; every customer recalculated). `GET /calculated` (`promo_uplift_calc.list_calculated`): `rows[]` (`customer_*`, `sku_range`, `mechanic_*`, `discount_pct`, `versions[]` of `effective_from`, `anchor`, `level`, `uplift_min`/`uplift_max`, `levels`, `skus[]` with `level`, `uplift_pct`, `anchor`, `moments`, `placeholder`), `calc_status`; `resolve_uplifts` `product_uplifts` + `product_anchors`; migrations `012_create_promo_uplift_settings.sql` + `013_promo_anchor_mechanic.sql` (append-only, newest row per target wins) | `settingsApi.js` wrappers (via `promoUpliftsApi.js`: `getCalculatedUplifts`, `saveMechanicDiscount`, `recalculatePromoUplifts`, `overwritePromoAnchor`, `saveFallbackAnchor`), `utils/promoUpliftCalc.js` (levels, labels, `explanationLines`; tests/promoUpliftCalc.test.mjs), `hooks/usePromoUpliftCalc.js` (also the Scenario builder's live uplifts: `utils/scenarioLiveUplifts.js`), `hooks/usePromoAnchors.js` (the anchor in a Monthly plan month and the hover card: `anchorTargets` / `anchorInMonth` in `promoUpliftSettings.js`), `PromoAnchorTable.jsx`, `PromoAnchorDetails.jsx`, `PromoAnchorOverwriteForm.jsx`, `PromoAnchorForm.jsx` (fallback only), `PromoMechanicTable.jsx`, `PromoMechanicDiscountForm.jsx`, `PromoUpliftTable.jsx`, `scenario/PromotionEditor.jsx` |
| `forecast_notifications` payload (`run_name`, `source` event/scheduled/script, `stage` pipeline/refresh, `reason`, `errors`, `warnings` (a success whose Initial couldn't refresh: `initial_refresh_warning`), `period_*`, `customers`, `skus`, `updated_at`) | `utils/forecastNotificationText.js`, `NotificationPanel.jsx` |
| `ai_models`: `FEATURES` labels/settings, `unavailable_message`, `model_outdated` payload (`features`, `settings`, `current_model`, `status`, `retires_on`, `suggested_model`), `GET /api/ai-models/status` (`{mapping, assistant}: {model, available, message}`); upload result `mapping.ai_unavailable` / `source: "manual"`; review packet `aiUnavailable` | `utils/aiModels.js` (`MODEL_FEATURES`, `modelUnavailableSentence`, `modelNotice`), `utils/notificationText.js` (`modelHeading`), `NotificationDetails.jsx` (`ModelDetails`), `utils/uploadFlow.js` (`aiUnavailable`), `UploadFileRow.jsx`, `ReviewHeader.jsx` |
| `assistant._FORECAST_LINES` (keys, labels, export colours; `chart_series[].key`/`unit`), `forecast_summary` `chart_lines` | `FORECAST_SERIES` in `utils/forecastView.js`, `AssistantChart` in `assistant/AssistantMessage.jsx` |
| `GET /api/forecast` rows: one per customer x SKU x month x **tier** (`bigquery.FORECAST_TIERS`, `FORECAST_OUTPUT_COLUMNS`: `tier`/`tier_label`/`tier_order`, `is_available`/`unavailable_reason`, `month_range_pct`/`month_confidence_band`, `previous_low_80`/`previous_high_80` (Previous's own run row in `aire_forecasting_runs`, joined on `previous_generated_at` + `source_model`; the view has none) with `previous_range_pct`/`previous_confidence_band` (`bigquery.month_range`, the view's 20/50 cut-offs), payload `horizon` `{tier: {units, series}}` (each series' whole Current line with no date filter, `bigquery.get_current_horizon` + `forecast_service.current_horizon_totals`: the "Next 12 months" strip). The Forecast page is **volume only**: rows and actuals carry no revenue and nothing is priced (`add_forecast_revenue` / `get_realised_prices` remain for the assistant's `forecast_summary` and `/alternatives`), `xreg_used_typical_promo`, `actual_status` (`reported`/`missing_file`/`not_yet`/`before_first_sale`, `bigquery.ACTUAL_STATUSES`), `output_built_at`); actuals rows carry `sku`; `availability` `{sku: {tier: {is_available, unavailable_reason, has_initial, has_previous}}}`, `tiers`, `freshness.by_tier` + `freshness.output_built_at` (`forecast_service.forecast_availability` / `forecast_tiers_from_rows` / `forecast_stamps_from_rows`). Never add rows of different tiers: `forecast_units`, `forecast_summary` and every `getForecastView` caller but /forecast use Tier 0. The Forecast page's output-table reads go through `bigquery.cached_read` (`forecast_cache`: single-flight, kept until `output_built_at` changes or 10 min; no time limit) | `forecastApi.getForecastView` (`tier`, default Tier 0; `ALL_TIERS` on /forecast), `utils/forecastTiers.js` (`forecastModelView`: the selected tier for one customer and All customers alike, never an average), `utils/forecastActuals.js` (missing / partial / real-0 actuals from `actual_status`, Actual line joins, Initial/Previous coverage per customer x SKU), `FORECAST_TIER_OPTIONS` / `UNAVAILABLE_REASON_TEXT` in `utils/forecastLineText.js`, `ForecastFilters` Model field, `ForecastConfidenceDetails.jsx`, `?tier=` on `app/forecast/page.js` |
| `GET /api/scenario/tier0-breakdown` (`scenario/tier0_breakdown.get_tier0_breakdown` → `tier0_split.month_split`: `rows[]` of `customer_id`, `sku`, `month_year`, `latest_month`, `tier0`, `run_rate`, `baseline`, `carried`, `base_method`, `last_year`/`recent[]` {`month`, `units`, `uplift_pct`, `promotions[]` {`mechanic`, `share`, `uplift_pct`, `level`}, `level`, `missing`}, `carried_level`, `official` {`planned`, `uplift_pct`, `promotions`, `level`, `missing`}); mechanic discounts by month (`promo_uplifts.mechanic_discount_lookup`, migration 021 `effective_from`) | `scenarioTier0BreakdownApi.getTier0Breakdown`, `hooks/useTier0Breakdown.js`, `utils/scenarioTier0Split.js` (`tier0SplitIndex`, `officialCells`, `promotionCells`, `monthSplit`), `scenarioComposition.js`, `scenario/Tier0Details.jsx` (an opened Monthly plan month), `MonthlyPlanTable.jsx` / `ScenarioYearComparison.jsx` (part columns), `FrozenBaselinePanel.jsx` (Breakdown tab: growth + what Simulated is made of over the months on the chart, `scenarioComposition.breakdownTotals`; no switches, everything switched on counts) |
| `GET /api/inventory/customers/{id}/sell-in-outlook?block_id=` (`get_sell_in_outlook(block_ids=)`: per month `sell_in_with_blocks` / `sell_out_with_blocks`, top-level `building_blocks[]` of `block_id`, `name`, `sell_out_change`); `scenario/block_effects` rules = `scenarioEngine.js` (`upliftDeltaCells`, `unitsDeltaCells`, `floorAtZero`) | `inventoryApi.getSellInOutlook` (`blockIds`), `useSellInOutlook`, `hooks/useSavedBuildingBlocks.js`, `utils/buildingBlocksOverlay.js`, `BuildingBlocksOverlay.jsx`, `SellInOutlookChart.jsx` (`showBlocks`) |
| `GET /api/forecast/initial-status` (`forecast_service.get_initial_status`: `years[]` of `forecast_year`, `lock_at`, `refreshed_at`, `locked`, from `aire_forecasting_initial_meta`; best effort, `[]` on error) | `forecastApi.getForecastInitialStatus`, `hooks/useForecastInitialStatus.js`, `utils/forecastLineText.js` (`initialStatusNotes`), `ForecastLegendFooter.jsx` |
| `GET /api/forecast/refresh-status` (`forecast_refresh_worker.refresh_status_best_effort`: `{ updating, since }` from pending/running `forecast_refresh_requests`; false on error or while event refresh is off) | `forecastApi.getForecastRefreshStatus`, `hooks/useForecastRefreshStatus.js` (60 s re-check only while updating), `utils/forecastLineText.js` (`forecastUpdatingBadge`, `nextStatusCheckDelay`), `ForecastLegendFooter.jsx` |
| `GET /api/uploads/history` (`upload_history.list_history`: `limit` 1-100, `offset`, `search`, `sort` `HISTORY_SORT_FIELDS`, `direction`; returns `uploads`, `total`, `unfiltered_total`, `limit`, `offset` (moved back to the last page when past the end); `STATUS_SORT_ORDER`) | `uploadApi.fetchUploadHistory`, `hooks/useUploadHistory.js`, `RecentUploads.jsx` (pages locally through a block of `config/upload.js` `UPLOAD_HISTORY_BLOCK` rows, at most the `limit` max, via `utils/tableView.js` `blockQuery`/`pageFromBlock`), `upload/columns.js` (`sortField`s) |
| `HTTPException.detail` shapes | `parseApiError()` |

When you change the left column, grep the right column in the same PR.

---

## 4. Configuration and environment (know the quirks)

One env file per side, each loaded in exactly one place:

| Side | File (gitignored) | Loaded by |
| --- | --- | --- |
| Backend | `backend/.env.backend` (template: `backend/.env.example`) | `app/config.py` — the only module that reads it; services import settings from `config` |
| Frontend | `frontend/aireos/.env.frontend` | `next.config.mjs` via `process.loadEnvFile` |

Quirks:
- `next.config.mjs` loads `.env.frontend` unconditionally, so `next dev` fails with
  `ENOENT ... .env.frontend` if the file is missing. (Next.js still auto-loads a `.env.local` if
  one exists, but `.env.frontend` is the team's file.)
- Add new backend settings to `config.py`, not `os.environ.get` in a service. `config.py` reads them
  once at import; a missing required value is checked where it is used, so it fails that request, not startup.

Backend variables: `GOOGLE_APPLICATION_CREDENTIALS`, `SERVICE_ACCOUNT_KEY_PATH`, `GCP_PROJECT_ID`,
`GCS_BUCKET_NAME`, `GCS_DESTINATION_PREFIX`, `GCS_DESTINATION_PREFIX_MAPPING`,
`BQ_FORECAST_DATASET` (default `aireos_forecast_validation_sg`: the forecast views and pipeline tables), `BQ_CDC_DATASET` (default `aireos_cdc_sg`: Datastream's `public_customers` / `public_skus`, the names the forecast is joined to), `BQ_FORECAST_LOCATION`, `BQ_FAIRPRICESELLOUT_TABLE` (legacy, unused), `BQ_FORECAST_OUTPUT_VIEW`, `MAPPING_MODEL`, `MAPPING_VERTEX_LOCATION`,
`GEMINI_ASSISTANT_MODEL`, `GCP_VERTEX_LOCATION`, `POSTGRESQL_INSTANCE_CONNECTION_NAME`,
`DB_IAM_USER`, `DB_NAME`, `CLOUD_SQL_LOAD_ENABLED`, `REQUIRE_LOAD_CONFIRMATION` (default false: known layouts load on
upload; true: they wait for a confirmed Load), `PROMO_RECALC_ENABLED` (default false; on only after migration 020:
saves then queue promotion recalculations), `PROMO_RECALC_HANDLER_URL` (the `/internal/promo/recalc` Cloud Run URL; the
task reuses the `FORECAST_REFRESH_*` queue, location and invoker), `AUTH_ENABLED`,
`AUTH_SESSION_SECRET`, `AUTH_ALLOWED_DOMAIN`, `AUTH_FRONTEND_URL`, `AUTH_COOKIE_SECURE`,
`AUTH_COOKIE_DOMAIN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`, the forecast view/table names (`BQ_SALES_ENRICHED_VIEW`,
`BQ_FORECAST_TABLE`, `BQ_MONTHLY_SALES_VIEW`, `BQ_TRAINING_RUN_LOG_TABLE`, `BQ_FORECAST_PIPELINE_VIEW`) and the
event refresh (`FORECAST_REFRESH_ENABLED`, `FORECAST_REFRESH_QUEUE`, `FORECAST_REFRESH_LOCATION`,
`FORECAST_REFRESH_HANDLER_URL`, `FORECAST_REFRESH_INVOKER`, `FORECAST_REFRESH_MAX_WAIT`,
`FORECAST_REFRESH_MAX_ATTEMPTS`). `config.py` is the full list. (`BQ_SELLOUT_TABLE` was removed --
the Sales Dashboard and Inventory read the Cloud SQL `sellout` table directly now, not a BigQuery replica.)

Frontend variables: `NEXT_PUBLIC_API_URL` (browser-visible, used everywhere),
`NEXT_PUBLIC_AUTH_ENABLED` (enables the route guard), `BACKEND_API_URL` (deployed builds
only: `next.config.mjs` forwards `/api/*` to it so the browser stays on one origin; unset locally).

Deployment (Cloud Run) is configured in `deploy/<env>/` and never through the local env files:
non-secret settings in `api.env.yaml` / `web.build.env` / `target.env`, secret **names** in
`api.secrets.yaml` (values in Secret Manager), applied by `deploy/deploy.ps1` or `deploy.sh`.
See README "Deploying"; `tests/test_deploy_config.py` keeps secrets out of the committed files.

Running locally: VS Code task **Start Both Servers**, or two terminals per the READMEs.
Tests: `cd backend && pytest`; `cd frontend/aireos && npm test`. Lint: `cd frontend/aireos && npm run lint`.
CI runs all three.

---

## 5. Roles — which hat to wear where

Adopt the role for the directory you are editing. When a change spans both, do the backend
half first (it defines the contract), then the frontend half, then update §3.4 if a contract moved.

### `/backend` — Strict Python architect
- You own the API contract. Every endpoint has a Pydantic model (bodies) or typed query args,
  one service call, and the §2.5 status-code map from CLAUDE.md. No logic in routers (`uploads.py`
  and `mappings.py` are the two frozen exceptions).
- You are paranoid about connections: one Engine/Client per process, autocommit engine for
  single SELECTs, `begin()` for anything that writes, `asyncio.to_thread` for blocking work in
  the async routers (`uploads.py`, `mappings.py`, the `notifications` stream).
- You never let user input reach SQL or BigQuery except through bind parameters.
- You write the failing pytest first, with a fake client, and you keep CI credential-free.
- You treat `skus`/`stores`/`retailers` and BigQuery as master data you read, not rewrite.
- You keep `TARGET_SCHEMA`, `PromoType`, and error `detail` shapes stable, because the frontend
  depends on them by name.

### `/backend/app/services/{layout_detection,column_profile,mapping_contract,mapping_checks,mapping_prompt,generate_mapping,mapping_view}` — Mapping generation
- Think in DataFrames and contracts: a contract has one entry per target field (`mapped` from a column or a melt
  group, `derived`, `constant`, `system`, `not_available` with a reason), `melt_groups` that select columns by rule
  (`pattern` / `between`), never by exact name, a `layout` and an `aggregate` instruction.
- Generation only writes and checks contracts; it never transforms or loads data, and its checks are static (it
  does not run the contract). The transformation reads the contract and does exactly what it says.
- Business rules as agreed with the product owner: monthly roll-up (B1, as `aggregate`), product codes to master
  SKUs through the contract's code table (B3), product details from the file, never revenue from
  claim/contra/price columns, and "not available" over a forced mapping.
- Gemini-generated contracts are JSON in GCS and always re-validated (`validate_contract`) and re-checked
  (`mapping_checks`) before being trusted. Confidence comes from the checks, not the model.
- Known layouts (template fingerprint) must never call the model. Keep that ordering in `resolve_mapping`.
- Golden tests run the real sample files in `tests/fixtures/retailer_samples/` (git-ignored; skipped when absent);
  CI covers the same traits with the synthetic files in `conftest.py`. `scripts/eval_mapping.py` scores proposals
  against `reference_contracts` -- rerun it when the prompt or model changes.

### `/frontend/aireos` — Pragmatic Next.js/React engineer
- Server Components by default; `'use client'` only where state/effects/handlers exist.
- Read `node_modules/next/dist/docs/` before using a Next API you are not certain of.
- React Compiler is on: honest dependency arrays, no manual memoisation for speed, derive
  during render.
- Every page uses `PageLayout`; every new control uses `app/components/ui/` primitives, theme
  tokens, `cn()`, and `lucide-react` per `CONTRIBUTING.md`.
- API calls go through `app/services/<domain>Api.js`; pure logic goes in `app/utils/`; fetching
  hooks go in `hooks/`. Render loading, error, and empty states.
- Animation goes through `motion/react` (the only animation library) or `lib/cardCascade`; respect
  `useReducedMotion`.

### `/backend/tests` — Test engineer
- One behaviour per test, named as a sentence. Fakes over mocks (`unittest.mock` only to patch one
  function or assert one call, never a `MagicMock` standing in for a client). Assert the contract
  (parameters, output shape, status code), not the implementation.
- Nothing touches the network. If a test needs credentials, it is not a test.

### Repo root, `.github/`, READMEs — Maintainer
- Keep `README.md`, `backend/README.md`, `frontend/aireos/README.md` truthful when structure
  changes.
- CI (backend pytest, frontend lint + node --test) must stay green and credential-free.
- Conventional Commits; branch `<type>/<short-descriptive-name>` (`feat/`, `fix/`, `refactor/`, `docs/`,
  `chore/`, `style/`; a ticket id such as `AO3-1` in the name is welcome, not required); PRs to `main`.
- Never commit `gcp-key.json`, `.env*`, or anything under `node_modules/`, `venv/`, `.next/`.

---

## 6. Known debt (don't be surprised by it; don't fix it as a drive-by)

Migrate these only when you are already in the file for other work (CLAUDE.md §1.5).

- **Fetch wrappers.** `promotionsApi.request` is the one wrapper. Still on their own: `forecastApi.js`
  (own `request()`), `mappingApi.js` (`request(baseUrl, …)`, left over from the deleted upload2 harness),
  raw `fetch` in `uploadApi.js` (`/check`), the hooks `useAssistant`, `useCustomerOptions`,
  `useDataFreshness`, and the components
  `dashboard/DashboardFilters`, `dashboard/SkuRanking`, `assistant/AssistantMessage`.
- **Router logic.** `mappings.py` reads GCS (`storage.download_json`, `list_mapping_fingerprints`,
  `download_bytes`) to build review packets; that belongs in a service. Don't add a third router like it.
- **Oversized components** (over ~300 lines): `ForecastChart` (828), `ui/DateRangePicker` (804),
  `PromotionForm` (683), `ScenarioBuilder` (590), `app/dashboard/page.js` (525),
  `AssistantMessage` (491), `MappingReviewPanel` (538), `app/promotions/page.js` (382), `SkuForm` (474);
  360-420: `SkuRanking` (385), `FieldTable`, `UploadProvider`, `PromotionsSection`, `CustomerStep` (413), `StepSettings`,
  `AssistantWidget`, `Sidebar`; 300-345: `PromotionEditor`, `RevenueSummaryCards`, `SellInOutlookChart`,
  `FieldMethodSettings`, `app/upload/page.js`, `ChannelSplit`, `UploadFileRow`. (`ui/chart.jsx` is shadcn-generated and the
  `app/testing` galleries are dev-only; leave them.)
- **Manual memoisation.** Performance-only, not needed under the React Compiler: `useMemo` in
  `ForecastChart`; `useCallback` on the `Dropzone` handlers and the
  `app/mappings/[id]` handlers. Check consumers before removing `useAssistant`'s `askQuestion` /
  `askDigest`. Allowed (identity is a correctness need): `UploadProvider`'s context actions, and the
  loaders in `app/upload`, `app/mappings`, `app/promotions`, `MappingReviewPanel`'s `runChecks` (its SKU auto-test effect lists it) and `useToast`'s `dismissToast` (read by
  `ui/Toast`'s timer effect), which effects list as dependencies.
- **Route tests incomplete.** `promotions.py` has `/revenue-estimate` (in `test_promotion_pricing.py`) and the
  list, `/filter-options` and the create/update 409 (in `test_promotions_router.py`): `GET /{id}`, `DELETE` and
  `/health/db` are untested. `uploads.py` has `/check`, `/load[/preview]` and `/history` (in
  `test_upload_check.py`, `test_upload_loading.py`, `test_upload_history.py`): `POST ""`, `/rollback` and
  `DELETE /source` are untested. (`internal_forecast.py` is covered in `test_forecast_refresh_worker.py`.)
- **`scenario_promotions` has no migration on `main`.** Its DDL is
  `backend/migrations/007_create_scenario_promotions.sql` on `feat/AO5-18&19-promotion-uplift-settings`
  (commit `700a37f`), which was left out when that branch's other migrations were renumbered to 012-014;
  the service and schema comments still say "migration 006".
- **`components/landing/`** (LandingHeader, ModuleGrid, …) isn't mounted by any page since `/` redirects
  to `/dashboard`; only a comment in `navItems.js` mentions it.

### Visual audit findings (11 Nov 2026)

Log these separately from the visual revamp; do not change application behavior to address them.

| File and line | Severity | Finding | Suggested fix |
| --- | --- | --- | --- |
| `frontend/aireos/app/components/ui/Dropdown.jsx:118` | Medium, accessibility | Placeholder text uses 50% deep blue on cream, about 2.4:1 contrast on a solid cream background. | Use a muted text token verified at 4.5:1 on every field surface. |
| `frontend/aireos/app/components/ui/SortHeader.jsx:9` | Medium, accessibility | Table labels use 60% deep blue; the contrast is below the normal-text AA target on some light surfaces. | Raise the shared table-header text contrast without changing sorting behavior. |
| `frontend/aireos/app/config/transitions.js:18` | Low, consistency | The card selector names an older opaque card class and may miss newer glass card frames during page cascades. | Use a stable, presentational card marker after checking every caller. |
| `frontend/aireos/app/components/layout/Sidebar.jsx:130` | Low, performance | Opening the sidebar animates its width, which can trigger layout work on slower devices. | Profile on mobile and consider a transform-based visual treatment if it causes jank. |
| `frontend/aireos/app/globals.css:4` | Medium, maintenance | The `tw-animate-css` workaround comment documents a hardcoded package path risk; the current import differs from the comment. | Reconcile the comment and import after checking a clean install and build. |
| `frontend/aireos/app/components/ui/surfaceStyles.js:3` | Medium, accessibility/performance | The earlier shared card style put `backdrop-blur-xl` on large content surfaces without a reduced-transparency fallback. | Keep the existing class for compatibility, cap blur to small floating surfaces, and supply opaque fallbacks in the visual theme. |
| `frontend/aireos/app/login/page.js:83` | Low, copy | The Google Workspace note contains a mojibake separator (`Â·`) in the source. | Replace the corrupted separator in a separate copy fix. |

The visual pass adds a manual light/dark toggle, the one approved exception to
the visual-only rule. It stores `aireos-theme` locally; it does not follow the
device setting or change application data.

### Visual issues addressed on the glass branch (11 Nov 2026)

| File and line | Severity | Finding | Visual fix |
| --- | --- | --- | --- |
| `frontend/aireos/app/components/upload/Dropzone.jsx:89`, `frontend/aireos/app/components/inventory/SellInUploadForm.jsx:122` | Low, affordance | File-picker text and the native file chooser did not consistently show a pointer cursor. | Give the actionable text and file input an explicit pointer cursor. |
| `frontend/aireos/app/components/layout/PageLayout.jsx:35` | Medium, mobile usability | Height-locked list pages could place the assistant over Promotions and SKU pagination. | Let fit-screen pages grow and scroll on mobile, preserving room after the table. |
| `frontend/aireos/app/components/ui/LineToggle.jsx:76` | Medium, accessibility | Active chart legend pills kept pale backgrounds while the dark theme made their text nearly white. | Use AIRE deep blue text on the light legend pills in both themes. |
