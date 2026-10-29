# agents.md — Architecture & Context Map for aireOS

This is the map. [claude.md](claude.md) is the rulebook. Read this before touching code so
you know which folder owns a concern, how data moves, and which "hat" to wear.

aireOS (Team WIP × Aire, final-year project) is an internal operations tool for a diaper/
personal-care brand selling through retailers (FairPrice first). It ingests retailer sellout
spreadsheets, shows a sales dashboard, manages promotion events, and tracks inventory (ending
stock, days of holding, DOH thresholds, a sell-in plan), and forecasts sell-out.

---

## 1. Repository layout

```
aireOS/
├── .github/workflows/ci.yml       CI: backend pytest only (Python 3.11, no cloud creds)
├── deploy/                        Cloud Run deploy: <env>/ settings + secret names, deploy & setup-secrets scripts (ps1 + sh)
├── .vscode/tasks.json             "Start Both Servers" task (uvicorn + next dev)
├── README.md                      Setup + the mapping workflow explanation
├── claude.md / agents.md          These files
│
├── backend/                       FastAPI app — run: uvicorn app.main:app --reload (:8000)
│   ├── app/
│   │   ├── main.py                FastAPI() instance, credentialed CORS, protected routers, GET /
│   │   ├── auth.py                Shared require_user dependency for protected API routers
│   │   ├── middleware.py          UnhandledErrorMiddleware (turns unhandled exceptions into JSON 500s)
│   │   ├── routers/               HTTP layer. One file per URL prefix.
│   │   │   ├── uploads.py         /api/uploads        file ingest + mapping review (async)
│   │   │   ├── auth.py            /api/auth           Google Workspace login/callback/session/logout
│   │   │   ├── sales.py           /api/sales          BigQuery dashboard reads
│   │   │   ├── catalog.py         /api/catalog        customer/retailer/store CRUD and links; SKU CRUD/search/filter/archive
│   │   │   ├── promotions.py      /api/promotions     promotion CRUD + /health/db
│   │   │   └── forecast.py        /api/forecast       sell-out forecast rows
│   │   │   ├── inventory.py       /api/inventory      overview, per-customer DOH, at-risk list, sell-in plan, record create/edit, temporary sell-in
│   │   │   ├── settings/          /api/settings       customer-level settings; __init__.py mounts one sub-router per kind
│   │   │   │   └── doh.py         /api/settings/doh   DOH thresholds (versioned, revert, history, reset to global default) + alert toggle
│   │   │   └── promotions.py      /api/promotions     promotion CRUD + /health/db
│   │   ├── schemas/               Pydantic v2 request models (only catalog + promotions today)
│   │   │   ├── catalog.py         _Base, normalise_name (names → lowercase slugs), CustomerCreate/Update,
│   │   │   │                      RetailerCreate (needs customer_id)/Update/Link, StoreCreate/Update,
│   │   │   │                      SkuItem + required SkuCreate/Update
│   │   │   ├── inventory.py       InventoryRecordCreate/Update, ShippedSoFarUpdate
│   │   │   ├── settings/common.py SettingsChangeBase (optional updated_by), shared by every kind of setting
│   │   │   ├── settings/doh.py    DohThresholdsUpdate (min <= target <= max, NUMERIC(6,2)), DohAlertUpdate, DohRevert, DohReset
│   │   │   └── promotions.py      PromoType Literal, PromotionStoreRef, PromotionBase/Create/Update
│   │   └── services/              All logic + all external I/O. Never imports fastapi.
│   │       ├── sql.py             Cloud SQL connector → SQLAlchemy Engine singletons (rw + autocommit read)
│   │       ├── auth_service.py    Google OIDC exchange, shop-aire.com checks, signed sessions
│   │       ├── inventory_calc.py  PURE: ending-stock chain, DOH, DOH threshold status (band from DOH settings), sell-in plan
│   │       ├── inventory_service.py inventory_metrics reads/writes + DOH thresholds via settings/doh (history by month) (raw SQL, one txn per write)
│   │       ├── settings/common.py shared by every kind of setting: engines, CustomerNotFoundError, lock_customer
│   │       ├── settings/doh.py    doh_settings (append-only versions) + customers alert columns; reads via the current_settings view; GLOBAL_DEFAULT_*_DOH 25/30/35
│   │       ├── sellout_units.py   Cloud SQL monthly sell-out per SKU for inventory, via sellout_service's effective-sellout view
│   │       ├── forecast_units.py  read-only BigQuery forecast units per SKU/month, from the aire_forecasting_output view (BQ_FORECAST_OUTPUT_VIEW)
│   │       ├── catalog_service.py retailers/stores/skus CRUD; SKU history/archive; get_or_create_* seams; retailer
│   │       │                      writes for the Customers page (always under a customer, blocked once it has stores)
│   │       ├── customer_service.py customers CRUD + list_customers (customers with nested retailers, in_use flags,
│   │       │                      unlinked retailers); a record with data can't be renamed/deleted (looked up by name)
│   │       ├── promotion_service.py promotions + promotion_stores + promotion_skus, raw SQL, one txn per write
│   │       ├── sellout_service.py Cloud SQL `sellout`: ingestion writes, plus the Sales Dashboard reads (SKU ranking,
│   │       │                      dashboard summary, period comparison, options, freshness) that used to go through
│   │       │                      BigQuery -- reads Cloud SQL directly now (no replication lag), and both this and
│   │       │                      sellout_units.py prefer monthly-granularity rows over weekly ones for the same
│   │       │                      retailer+month when both exist (EFFECTIVE_SELLOUT_CTE)
│   │       ├── bigquery.py        Forecast reads only (get_forecast_output_rows, get_realised_prices, get_forecast_actuals,
│   │       │                      get_forecast_options, get_sales_loaded_at) + get_bigquery_client; the Sales Dashboard
│   │       │                      functions that used to live here moved to sellout_service.py
│   │       ├── storage.py         GCS: upload files (duplicate detection), mapping JSON packets
│   │       ├── upload_check.py    Read-only pre-upload check (POST /api/uploads/check): duplicate + mapping preview, no writes, no model call
│   │       ├── upload_loading.py  Loading uploads into sell-out as its own confirmed step: per-upload load state after an approval,
│   │       │                      dry run (rows, periods, rows replaced/overwritten) and the load itself (POST /api/uploads/load[/preview])
│   │       ├── layout_detection.py PURE: finds the data table in an upload (sheet not a pivot, header row, preamble +
│   │       │                      stated period, footer/total rows, total + spacer columns, merged cells filled down)
│   │       ├── column_profile.py  PURE: whole-file column profile, repeated period/outlet column groups, template fingerprint
│   │       ├── mapping_contract.py PURE: contract v2 -- instructions only: one entry per target field (mapped/derived/
│   │       │                      constant/system/not_available), layout, aggregate (monthly roll-up), sku code table;
│   │       │                      upgrade()/downgrade() for v1, validate_contract, required fields, reviewer diff
│   │       ├── generate_mapping.py Confirmed-contract lookup (template + legacy fingerprint), near-match, Gemini proposal with
│   │       │                      check-and-repair loop for unknown layouts
│   │       ├── mapping_prompt.py  PURE: field definitions, glossary, per-file JSON output schema, prompt text
│   │       ├── mapping_checks.py  PURE: static checks of a contract against its file (never runs it): every product code a
│   │       │                      master SKU, required fields, rule coverage, revenue-name guard, stated period; confidence
│   │       ├── reference_contracts.py Hand-written v2 contracts for FairPrice / NHG / Sheng Siong (golden tests, prompt examples, eval)
│   │       ├── mapping_view.py    Contracts <-> the review screen's "packet"/"rules" shape (one rule per target field)
│   │       ├── apply_contract.py  Deterministic transformation executor for version 1 and version 2 mapping contracts
│   │       ├── validation_service.py Row-level validation against TARGET_SCHEMA after mapping
│   │       ├── pl_forecast.py     Pure P&L sell-out forecast (base + building blocks), no I/O
│   │       └── forecast_service.py BigQuery reads/MERGEs for the forecast table, refresh_forecast()
│   ├── tests/                     pytest; fakes for BigQuery/GCS clients; no network
│   ├── pytest.ini                 pythonpath=. testpaths=tests
│   ├── requirements.txt           fastapi, uvicorn, pandas, openpyxl, sqlalchemy, cloud-sql-python-connector[pg8000],
│   │                              google-cloud-bigquery, google-cloud-storage, google-genai, python-dotenv, python-multipart
│   ├── .env.backend               (gitignored) GCP + Cloud SQL + Vertex AI config — see §4
│   └── gcp-key.json               (gitignored) service-account key
│
└── frontend/aireos/               Next.js 16.3 App Router, React 19.2, JavaScript — run: npm run dev (:3000)
    ├── app/
    │   ├── layout.js              Root layout: DM Sans / DM Serif / Geist Mono fonts, globals.css
    │   ├── page.js                Redirects the authenticated root route to /dashboard
    │   ├── login/page.js          Enterprise SSO login and callback-error messages
    │   ├── globals.css            Tailwind v4 + shadcn tokens + "AIRE brand kit" CSS vars + .dark
    │   ├── upload/page.js         Production upload + mapping review screen (uses components/upload)
    │   ├── upload2/page.js        Developer "mapping harness" (uses components/upload2, manual API base URL)
    │   ├── dashboard/page.js      Sales dashboard: customer/sku/store/date filters, trend chart, ranking
    │   ├── promotions/page.js     Promotion create/edit/delete + overview list
    │   ├── forecast/page.js       Sell-out forecast chart/table, default view = current year only
    │   ├── customers/page.js      Customers: customers + their retailers, add/rename/delete, link unlinked retailers (components/customers)
    │   ├── doh/page.js            DOH Settings: per-customer thresholds, alert toggle, edit, reset to global default (components/settings)
    │   ├── inventory/page.js      Inventory: overview, by-customer DOH, at-risk list, sell-in plan, enter/edit data (components/inventory)
    │   ├── components/
    │   │   ├── layout/            AppShell (sidebar + content), PageLayout (title + column), Sidebar (NAV_ITEMS)
    │   │   ├── ui/                shadcn primitives: button, card, tabs, chart, switch, calendar, popover, DateRangePicker
    │   │   │                      (typed date inputs, not a calendar); MonthGrid (year + 12-month grid, shared by
    │   │   │                      promotions MonthPicker and the dashboard month-range picker); Toast (+ hooks/useToast);
    │   │   │                      list-table kit (Customers + Promotions): DataTable (card: count, search slot, refresh,
    │   │   │                      Retry, empty state, footer) → TableGrid (column config → fixed widths, sort headers,
    │   │   │                      skeleton; `nested` variant + `inset` for tables inside rows), ExpandableRow, RowActions
    │   │   │                      ("..." menu, disabledReason), StatusPill; + hooks/useExpandedRows, hooks/useConfirmAction
    │   │   ├── dashboard/         DashboardFilters, CustomerSelector, FilterBadge, PeriodControls (Period /
    │   │   │                      Compare to: DateRangeControl, CompareControl, MonthRangeCalendar — whole months only),
    │   │   │                      RevenueTrendCard (always by format) → TrendChart (FormatTrendChart),
    │   │   │                      ComparisonMixChart; PeriodTexture (hatched "past period" fills), TooltipChange,
    │   │   │                      PeriodComparisonDetail, RevenueSummaryCards + FormatMixBar, SkuRanking
    │   │   ├── promotions/        PromotionForm, PromotionList → PromotionRow (on ui/DataTable), columns.js, CheckboxDropdown
    │   │   ├── customers/         CustomersView (state), CustomerTable → CustomerRow (expandable, retailers inside),
    │   │   │                      RetailerTable (nested TableGrid), columns.js (shared grid), NameFormDialog,
    │   │   │                      LinkRetailerDialog, UnlinkedRetailers
    │   │   ├── skus/              SKU catalog filters/table, create-edit form, details/history
    │   │   ├── forecast/          ForecastChart/Filters/Table, HeaderCheckboxFilter (shared)
    │   ├── services/              Backend API wrappers
    │   │   ├── promotionsApi.js   request() + parseApiError() + promotion/retailer/store endpoints
    │   │   ├── catalogApi.js      SKU CRUD, details, options and archive API wrappers
    │   │   ├── forecastApi.js     getForecastRows/Options, own request() (no baseUrl arg)
    │   │   ├── settings/          DohSettingsView (state), DohSettingsTable, DohThresholdForm
    │   │   ├── upload/            FileUpload (925 lines), MappingReview, FileUploadSummary (empty)
    │   │   └── upload2/           Harness pieces: MappingDiv, UploadPanel, ResultsPanel, ContractView, RequestLog…
    │   │   ├── salesApi.js        /api/sales wrappers via request() (getSkuSales, getMonthlyOnly)
    │   │   ├── settingsApi.js     /api/settings/* wrappers, one section per kind (reuses promotionsApi.request)
    │   │   ├── catalogApi.js      /api/catalog customers + retailer writes for the Customers page (reuses promotionsApi.request)
    │   │   └── mappingApi.js      /api/uploads wrappers taking an explicit baseUrl (harness style)
    │   └── utils/                 Pure, React-free helpers
    │       ├── promotionForm.js   PROMO_TYPES, EMPTY_PROMOTION_FORM, validate/build/formFrom helpers
    │       ├── skuForm.js         required-field validation and SKU form/payload conversion
    │       ├── promotionOverview.js list grouping/filter helpers
    │       ├── forecastView.js    Sell-out run series (Initial Yearly Forecast/Previous/Current), tier resolution
    │       ├── dateRange.js       currentYearDateRange() -- shared default-date-range helper
    │       ├── periodComparison.js Compare-to baselines (comparisonSetup), week pairing for the comparison chart
    │       ├── dateRangePresets.js Period presets in whole months (Latest month … Past 12 months, YTD, Last year), anchored to the latest loaded month
    │       ├── trendChart.js      Trend chart labels, x-axis setup, bar sizing, format stack order
    │       ├── weeklyGaps.js      "No weekly data for …" message: monthly-only months merged into ranges, capped
    │       ├── priceMix.js        Avg-price change split into SKU price vs product mix
    │       ├── storeFormats.js    FORMAT_COLORS + formatColor() per store format
    │       ├── dohSettingsForm.js validate/build/formFrom helpers for the DOH threshold form, GLOBAL_DEFAULT_DOH
    │       ├── customerForm.js    normaliseName (mirrors backend slug), validateName, edit/delete block reasons
    │       ├── retailerLabel.js   shared display label for retailer/customer slugs (fairprice_online → Fairprice Online)
    │       └── mappingHelpers.js
    ├── proxy.js                   Optimistic route guard: missing session cookie → /login
    ├── hooks/                     Data-fetching hooks (cancel-flag pattern; dashboard calls services/*Api.js)
    │   ├── useDataFreshness.js    polls /api/sales/last-updated → { channels, dataVersion, refreshing }
    │   ├── useCustomerOptions.js  /api/sales/customer-options
    │   ├── useDashboardSummary.js /api/sales/dashboard-summary (silent refresh on dataVersion)
    │   ├── useDefaultDateRange.js /api/sales/default-date-range
    │   ├── useSkuSales.js         /api/sales/skus via salesApi.getSkuSales
    │   ├── useMonthlyOnly.js      /api/sales/monthly-only via salesApi.getMonthlyOnly (months with no weekly breakdown → month bars)
    │   ├── usePriceMix.js         useSkuSales × 2 (this period + comparison) → priceMixEffects
    │   ├── useDohSettings.js      /api/settings/doh (+ replaceRow for the row a write returns)
    │   ├── useCustomers.js        /api/catalog/customers (+ applyCustomer / removeCustomer for the row a write returns)
    │   ├── useExpandedRows.js     { isExpanded, toggle, expand } for ui/ExpandableRow (several open by default)
    │   ├── useConfirmAction.js    { target, isPending, request, cancel, confirm } for ui/ConfirmDialog (e.g. Delete)
    │   └── useToast.js            { toast, notify, dismissToast } for components/ui/Toast
    ├── lib/                       cn() (clsx + tailwind-merge), formatDateRange, formatDate/formatDateTime (shared date display,
    │                              Singapore time), singaporeTime (singaporeDateTimeParts, singaporeToday)
    ├── public/                    create-next-app SVGs
    ├── CONTRIBUTING.md            Frontend UI conventions (primitives, tokens, cn(), lucide) — binding
    ├── CLAUDE.md → @AGENTS.md     Next.js auto-generated notice: read node_modules/next/dist/docs before Next APIs
    ├── components.json            shadcn: style base-nova, rsc true, tsx false, aliases @/components, @/lib, @/hooks
    ├── jsconfig.json              @/components/* → app/components/*, @/* → ./*
    ├── next.config.mjs            reactCompiler: true
    ├── eslint.config.mjs          eslint-config-next/core-web-vitals
    └── .env.frontend              (gitignored, required) NEXT_PUBLIC_API_URL — loaded by next.config.mjs, see §4
```

Key dependencies: `@base-ui/react`, `shadcn`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `lucide-react`, `recharts`, `react-day-picker` (+ its `date-fns`, behind
`ui/calendar`), `tw-animate-css`, `babel-plugin-react-compiler`.
No test runner is installed on the frontend; linting (`npm run lint`) is the frontend check.

---

## 2. Domains and their backing stores

| Domain | Router | Service(s) | Storage | Frontend entry |
| --- | --- | --- | --- | --- |
| Authentication | `auth.py` | `auth_service`, shared `app.auth.require_user` dependency | Google Workspace OIDC; signed HTTP-only `aireos_session` cookie (no application password store) | `app/login`, root `proxy.js` |
| Upload & mapping | `uploads.py`, `mappings.py` | Generation: `layout_detection`, `column_profile`, `generate_mapping`, `mapping_prompt`, `mapping_contract`, `mapping_checks`, `mapping_view`. Transformation: `sellout_ingestion`, `apply_contract`, `validation_service` | **GCS** bucket: `uploads/` files, `mappings/pending/<fp>.json`, `mappings/confirmed/<fp>.json`, `mappings/history/<fp>/v<n>.json`. **Cloud SQL** `skus` read-only, to check product codes | `app/upload`, `app/mappings`, `services/mappingApi.js` |
| Sales dashboard | `sales.py` | `sellout_service` | **Cloud SQL Postgres**: `sellout` (the source of truth -- every upload writes here first; `retailer_id`/`store_code`/`sku` rows, `period_type` `week` or `month`), joined to `retailers`/`stores`/`skus` for names (retailer name = `{customer}_{offline|online}`). A retailer+calendar-month with monthly-granularity rows uses only those (never both, see `EFFECTIVE_SELLOUT_CTE`); `granularity='week'` summary views read genuine weekly rows only. No more BigQuery/Datastream replication lag -- reads are real-time | `app/dashboard`, `hooks/use*.js`, `services/salesApi.js` |
| Catalog | `catalog.py` | `catalog_service`, `customer_service` | **Cloud SQL Postgres**: `customers`, `customer_retailers`, `retailers`, `stores`, `skus`, `sku_history`. Names are lowercase slugs, unique case-insensitively. A retailer with stores, or a customer with any such retailer or `inventory_metrics` rows, is `in_use` and can't be renamed or deleted. `skus` keeps one stable foreign-key master row per code; `sku_history` stores its timestamped created/updated/archived versions. Historical price reads resolve the version effective on the requested date. | `app/customers`, `app/skus`, `services/catalogApi.js`; `services/promotionsApi.js` (getRetailers/getStores/getSkuRanges) |
| Inventory | `inventory.py` | `inventory_service`, `inventory_calc`, `sellout_units`, `forecast_units` | **Cloud SQL Postgres**: `customers`, `customer_retailers`, `inventory_metrics` (long format; app writes carry `data_source='manual_entry'`; only sell-in, a first-month opening and building blocks (stock used outside sell-out) are read; workbook rows are never changed), `doh_settings` (read via `settings/doh.fetch_versions`; closed months use the version in effect at month end, the latest month, at-risk list and sell-in plan use the current one), `sellout` (sell-out, via `sellout_units`/`sellout_service`'s effective-sellout view, same monthly-preferred-over-weekly rule as the dashboard); **BigQuery** (read-only): the forecast table. Ending stock, DOH and the plan are computed, never stored | `app/inventory`, `services/inventoryApi.js` |
| Settings (DOH) | `settings/doh.py` | `settings/doh`, `settings/common` | **Cloud SQL Postgres**: `doh_settings` (append-only: a change is an INSERT only when min/target/max differ from the newest row; newest by `updated_at DESC, setting_id DESC`; never UPDATE/DELETE, except that a new customer gets a global-default row; `customer_id` is ON DELETE CASCADE, so deleting a customer deletes its rows and DOH settings never block it), view `current_settings` (one row per customer), `customers.doh_alert_enabled` / `doh_alert_updated_at` (in-place toggle, no version). Also read by the inventory DOH calculations (`fetch_versions`, `thresholds_on`, `current_thresholds`) | `app/doh`, `services/settingsApi.js` |
| Promotions | `promotions.py` | `promotion_service` (+ `catalog_service` seams) | **Cloud SQL Postgres**: `promotions`, `promotion_stores`, `promotion_skus`; enum `promo_type_enum`; trigger `trg_promotions_updated_at` | `app/promotions`, `services/promotionsApi.js` |
| Forecast (P&L) | `forecast.py` (`/api/forecast`, read-only; writes are out of band via `scripts/refresh_forecast.py`) | `pl_forecast` (pure), `forecast_service`, `catalog_service` (product prices) | **BigQuery** (`Aire_Data_Analytics`, read-only): model learns from `v_sales_enriched` (weekly), page Actual line reads `v_customer_monthly_sales`; refresh MERGEs into `BQ_FORECAST_TABLE`. **Cloud SQL Postgres**: `skus.price` prices sell-out revenue | `app/forecast` |
| AI mapping | (inside uploads, `mappings.py`) | `generate_mapping` | **Gemini on Vertex AI** (`google-genai`, `MAPPING_MODEL` default `gemini-3.8-flash`, `MAPPING_VERTEX_LOCATION` default `global`, signed in as the service account, no API key). Pending proposals record `provider` + `model` (ones made before the move to Gemini say `anthropic`); `scripts/eval_mapping.py` scores proposals against `reference_contracts` | — |
| Assistant | `assistant.py` (`/api/assistant`) | `assistant` | **Gemini on Vertex AI** (`GEMINI_ASSISTANT_MODEL`, default `gemini-3.8-flash`; `GCP_VERTEX_LOCATION`, default `global`), both set in `config.py` | floating widget (`components/assistant`) |

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
- The transformation (`sellout_ingestion` → `apply_contract`) runs both contract formats. Version 2 executes layout,
  field, melt, transform and aggregate instructions; version 1 remains supported for existing mappings. An amended
  version 1 mapping is written back in version 1 when it fits (`mapping_contract.downgrade`).
- Time: the backend stores and returns instants in UTC (TIMESTAMPTZ, Postgres sessions pinned to UTC
  in `sql.py`, ISO strings with `Z`/`+00:00`) and takes "today" as the UTC day, never `date.today()`.
  The frontend shows every time in Singapore time through `lib/formatDate.js`, and uses
  `singaporeToday()` instead of `new Date()` for "today / this month / this year". Bare `YYYY-MM-DD`
  dates are calendar dates and are never shifted. (Exceptions by design: DOH month boundaries in
  `settings/doh.py`, the date printed on assistant reports, the assistant's "today" (so "this month" /
  "next month" in a question mean the Singapore month) and `forecast_summary.py`'s month-to-date
  check are Singapore days.)

---

## 3. Data flow and communication patterns

### 3.1 Transport

- Browser → FastAPI over `fetch`, JSON bodies, base URL `NEXT_PUBLIC_API_URL`
  (`http://localhost:8000` in dev). Protected requests include the signed HTTP-only session cookie;
  every page that loads application data is a `'use client'` tree.
- CORS is wide open only while authentication is disabled for development. With SSO enabled,
  `main.py` allows the configured `AUTH_FRONTEND_URL` and credentials.
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
1. `FileUpload.jsx` posts files. Router reads every stream once, `asyncio.to_thread(storage.upload_many)`
   (duplicate-filename check unless `force`).
2. Per file, concurrently (`asyncio.gather` → `to_thread(resolve_and_apply_mapping)`):
   `generate_mapping.resolve_mapping`: `layout_detection.read_table` → fingerprint the header templates →
   `mappings/confirmed/<fp>.json` (or a compatible legacy fingerprint) → `status: "mapped"`; either contract format
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
   any previous version under `mappings/history/` and stores it under `confirmed/`. `DELETE .../{fp}/pending` discards.
   The page is numbered steps (customer → fields → product codes → checks) beside a "What's left" list
   (`utils/reviewChecklist.js`). A mapping belongs to a **customer**: confirm requires `customer_id` (stored as
   `customer_id`/`customer_name`, and as `vendor` for upload history) and 422s while any retailer the contract writes
   to (`mapping_contract.retailer_outputs`) is not that customer's -- otherwise uploads would create retailers no
   customer owns and the dashboard would never show their sales. A new customer is created from the page with its
   `<name>_offline`/`<name>_online` retailers in one transaction (`CustomerCreate.retailer_names`).
   **Approving loads nothing.** `upload_loading.mark_uploads_after_approval` re-stamps the files behind the mapping
   (`ready_to_load`, or `reload_available` for files loaded with an older version) and confirm returns them as
   `waiting_uploads` / `outdated_uploads`.
4. Loading is a separate step, because an upsert into `sellout` overwrites other files' values and cannot be undone
   from the app. `LoadConfirmDialog` (from the approved screen, Recent uploads, or the upload row when the flag is on)
   calls `POST /api/uploads/load/preview` -- a dry run per file: rows to store, periods, retailers, rows replaced
   (same `source_file`) and rows overwritten per other file (`sellout_service.existing_overlap`) -- and only on the
   person's confirmation `POST /api/uploads/load`, which re-checks each file, loads it with the current confirmed
   version (`replace_source=True`) and stamps it `mapped` with `mapping_version`. Upload states: `pending_confirmation`
   → `ready_to_load` → `mapped` (loaded) → `reload_available` after a new version.

**Dashboard** (`app/dashboard/page.js`)
1. `useDataFreshness` polls `/api/sales/last-updated`; a change bumps `dataVersion`, which every
   other hook lists as a dependency so data silently refreshes.
2. `useCustomerOptions` → first customer auto-selected during render.
3. `useDefaultDateRange` (week) gives the latest loaded period; every Period preset (whole
   months — the dashboard works in monthly figures) is built from its month on the client
   (`dateRangePresets.js`), and `comparisonSetup` derives the
   "Compare to" baseline range (none by default). `useDashboardSummary` is called for this
   period and, while comparing, for the baseline. Hooks take
   `{ customer, sku, store, startDate, endDate, mode, dataVersion }` and hit `/api/sales/*`;
   each maps to one `bigquery.get_*` function that builds a parameterised query.
4. The chart opens By month; By week is a drill-down, disabled when no month in the range has
   weekly rows (`useMonthlyOnly`). Both sides of a comparison are read at the chart's
   granularity — monthly totals by month, weekly rows by week — so they compare the same kind
   of data; `alignComparisonBuckets` pairs them on the client.
5. While a comparison is on, `usePriceMix` fetches per-SKU sales for both periods
   (`/api/sales/skus`) so the Comparison panel can split the average-price change.

**Promotions** (`app/promotions/page.js`)
1. On mount: `getRetailers`, `getStores`, `getSkuRanges`, `getPromotions` (all in `promotionsApi.js`).
2. Form state lives in one `form` object; `validatePromotionForm` → `buildPromotionPayload`
   produces `{ stores:[{retailer, store_name, store_code, store_format}], period_start,
   period_end, period_label, promo_type, promotion_mechanic, voucher, skus:[{sku, sku_range}] }`.
3. `POST /api/promotions` → Pydantic `PromotionCreate` (date order, unique stores, unique skus)
   → `promotion_service.create_promotion` in **one transaction**: insert `promotions` →
   `get_or_create_retailers/stores` for the whole batch → insert `promotion_stores` → resolve `sku_range` to
   catalog `skus` → upsert `promotion_skus` → `_fetch_promotion` returns the row with nested
   `stores[]` / `skus[]` via `json_agg`.
4. `PUT` replaces link rows wholesale; `DELETE` removes links then the promotion.
   The response `promotion` object is what `formFromPromotion` reads back for edit.

### 3.4 Contracts that must stay in sync across the stack

| Backend | Frontend |
| --- | --- |
| `PromoType` Literal in `schemas/promotions.py` and `promo_type_enum` in Postgres | `PROMO_TYPES` in `app/utils/promotionForm.js` |
| `PromotionBase` field names | `buildPromotionPayload` / `formFromPromotion` |
| `_PROMOTION_COLUMNS` (nested `stores`, `skus`) | `PromotionList.jsx`, `promotionOverview.js` |
| `sales.py` query-param names (`start_date`, `end_date`, `granularity`, `customer`, `store`, `sku` …) | `URLSearchParams` keys in `hooks/*.js` and `services/salesApi.js` |
| `mapping_view` packet/rule keys (`targetField`, `sourceColumn`, `editable`, `status`, `field`, `meltGroup`, `options`, `description`, `requiredMissing`, `checks`) | `utils/mappingReview.js`, `components/mappings/*` |
| `mapping_checks` check shape (`id`, `level`, `passed`, `message`, `fields`, `evidence`) | `utils/mappingChecks.js`, `MappingChecks.jsx` |
| packet `skuCodes`, `masterSkus`, `contractFormat`, `instructions`; processing preview/rejection fields | `utils/skuCodeTable.js`, `SkuCodeTable.jsx`, `MappingReviewPanel.jsx`, `UploadFileRow.jsx` |
| `uploads.py` per-file `mapping.status` values (`mapped`, `ready_to_load`, `pending_confirmation`, `mapping_failed`) | `utils/uploadFlow.js` (`outcomeFromResult`) |
| upload `mapping_status` load states (`ready_to_load`, `mapped`, `reload_available`, in `upload_loading`); load preview/result keys (`preview_loads`, `load_uploads`, `sellout_ingestion.preview_confirmed_upload`); confirm `waiting_uploads`/`outdated_uploads`/`load_requires_confirmation` | `utils/uploadHistory.js`, `utils/loadPreview.js` (`LOAD_PREVIEW_FIELDS`), `LoadConfirmDialog.jsx` → `LoadFileRow.jsx` (sample rows via `OutputPreview`), `ApprovedSummary.jsx` |
| `settings/doh._settings_view` keys, `GLOBAL_DEFAULT_*_DOH` | `DohSettingsTable.jsx`, `dohSettingsForm.js` (`GLOBAL_DEFAULT_DOH`) |
| `DohThresholdsUpdate` field names | `buildDohThresholdPayload` |
| `ConfirmRequest.customer_id`; packet `customerId`, `customerName`, `sourceFilename`; `mapping_contract.retailer_outputs` | `mappingApi.confirmMapping`, `utils/mappingCustomer.js` (`retailerOutputs` mirrors it), `utils/mappingList.js` |
| packet `columnGroups` (`mapping_view.column_groups`: detected groups from `column_profile.review_column_groups`, with contract-ready `group` settings, `readings`, `meltGroupId`/`field`) and `measureFields` | `utils/mappingReview.js` (`toGroups`, `groupChoices`, `toRules`), `FieldTable.jsx`, `ColumnGroupDetails.jsx`, `UnusedColumns.jsx`. `review_column_groups` adds month-named headings for review only -- never fold them into `detect_column_groups`, which the layout fingerprint is built from |
| `CustomerCreate.retailer_names` (`customer_service._attach_retailer`: links a retailer an upload made, 409 for another customer's) | `NewCustomerDialog.jsx` |
| `customer_service.list_customers` keys (`customers[].retailers[]`, `in_use`, `unlinked_retailers`), retailer writes' `{ retailer, customer }` | `useCustomers.js`, `components/customers/*` |
| `schemas.catalog.normalise_name` slug rule, `in_use` rules | `customerForm.js` (`normaliseName`, `*BlockReason`) |
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
  Branches cut before `main`'s AO1-9 merge (`206949a`) still read `.env.local` instead.
- Add new backend settings to `config.py`, not `os.environ.get` in a service.

Backend variables: `GOOGLE_APPLICATION_CREDENTIALS`, `SERVICE_ACCOUNT_KEY_PATH`, `GCP_PROJECT_ID`,
`GCS_BUCKET_NAME`, `GCS_DESTINATION_PREFIX`, `GCS_DESTINATION_PREFIX_MAPPING`,
`BQ_FAIRPRICESELLOUT_TABLE` (legacy, unused), `BQ_FORECAST_OUTPUT_VIEW`, `MAPPING_MODEL`, `MAPPING_VERTEX_LOCATION`,
`GEMINI_ASSISTANT_MODEL`, `GCP_VERTEX_LOCATION`, `POSTGRESQL_INSTANCE_CONNECTION_NAME`,
`DB_IAM_USER`, `DB_NAME`, `CLOUD_SQL_LOAD_ENABLED`, `REQUIRE_LOAD_CONFIRMATION` (default false: known layouts load on
upload; true: they wait for a confirmed Load), `AUTH_ENABLED`,
`AUTH_SESSION_SECRET`, `AUTH_ALLOWED_DOMAIN`, `AUTH_FRONTEND_URL`, `AUTH_COOKIE_SECURE`,
`AUTH_COOKIE_DOMAIN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`. (`BQ_SELLOUT_TABLE` was removed --
the Sales Dashboard and Inventory read the Cloud SQL `sellout` table directly now, not a BigQuery replica.)

Frontend variables: `NEXT_PUBLIC_API_URL` (browser-visible, used everywhere),
`NEXT_PUBLIC_AUTH_ENABLED` (enables the route guard), `BACKEND_API_URL` (deployed builds
only: `next.config.mjs` forwards `/api/*` to it so the browser stays on one origin; unset locally).

Deployment (Cloud Run) is configured in `deploy/<env>/` and never through the local env files:
non-secret settings in `api.env.yaml` / `web.build.env` / `target.env`, secret **names** in
`api.secrets.yaml` (values in Secret Manager), applied by `deploy/deploy.ps1` or `deploy.sh`.
See README "Deploying"; `tests/test_deploy_config.py` keeps secrets out of the committed files.

Running locally: VS Code task **Start Both Servers**, or two terminals per the READMEs.
Tests: `cd backend && pytest`. Lint: `cd frontend/aireos && npm run lint`.

---

## 5. Roles — which hat to wear where

Adopt the role for the directory you are editing. When a change spans both, do the backend
half first (it defines the contract), then the frontend half, then update §3.4 if a contract moved.

### `/backend` — Strict Python architect
- You own the API contract. Every endpoint has a Pydantic model (bodies) or typed query args,
  one service call, and the §2.5 status-code map from claude.md. No logic in routers.
- You are paranoid about connections: one Engine/Client per process, autocommit engine for
  single SELECTs, `begin()` for anything that writes, `asyncio.to_thread` for blocking work in
  the one async router.
- You never let user input reach SQL or BigQuery except through bind parameters.
- You write the failing pytest first, with a fake client, and you keep CI credential-free.
- You treat `skus`/`stores`/`retailers` and BigQuery as master data you read, not rewrite.
- You keep `TARGET_SCHEMA`, `PromoType`, and error `detail` shapes stable, because the frontend
  depends on them by name.

### `/backend/app/services/{layout_detection,column_profile,mapping_contract,mapping_checks,mapping_prompt,generate_mapping,mapping_view}` — Mapping generation
- Think in DataFrames and contracts: a v2 contract has one entry per target field (`mapped` from a column or a melt
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
- `upload2/` is a developer harness; do not spend polish on it, and do not let production
  `upload/` import from it.

### `/backend/tests` — Test engineer
- One behaviour per test, named as a sentence. Fakes over mocks. Assert the contract
  (parameters, output shape, status code), not the implementation.
- Nothing touches the network. If a test needs credentials, it is not a test.

### Repo root, `.github/`, READMEs — Maintainer
- Keep `README.md`, `backend/README.md`, `frontend/aireos/README.md` truthful when structure
  changes.
- CI must stay green and credential-free.
- Conventional Commits; branch `feat/AO<n>-<m>-desc`, `fix/…`, `refactor/…`; PRs to `main`.
- Never commit `gcp-key.json`, `.env*`, or anything under `node_modules/`, `venv/`, `.next/`.

---

## 6. Known debt (don't be surprised by it; don't fix it as a drive-by)

- `app/page.js` redirects to `/dashboard`; unauthenticated application routes are intercepted by `proxy.js`.
- `FileUpload.jsx` and `PromotionList.jsx` are oversized; extract when already editing them.
- Two fetch-wrapper styles (`promotionsApi.request` vs `mappingApi.request(baseUrl, …)`) and
  raw `fetch` in dashboard hooks. New code uses the `promotionsApi` style.
- CI covers backend only.
