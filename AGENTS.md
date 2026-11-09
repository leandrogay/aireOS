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
├── .github/workflows/ci.yml       CI: backend pytest only (Python 3.15, no cloud creds)
├── deploy/                        Cloud Run deploy: <env>/ settings + secret names, deploy & setup-secrets scripts (ps1 + sh)
├── .vscode/tasks.json             "Start Both Servers" task (uvicorn + next dev)
├── README.md                      Setup + the mapping workflow explanation
├── claude.md / agents.md          These files
│
├── backend/                       FastAPI app — run: uvicorn app.main:app --reload (:8000)
│   ├── app/
│   │   ├── main.py                FastAPI() instance, credentialed CORS, protected routers, GET /
│   │   ├── auth.py                Shared require_user dependency for protected API routers; current_user_email
│   │   │                          (settings writes record it as updated_by, never a name sent in the body)
│   │   ├── middleware.py          UnhandledErrorMiddleware (turns unhandled exceptions into JSON 500s)
│   │   ├── assets/                aire-logo.png: the AIRE logo on exported PDFs and slides (copy of the frontend's)
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
│   │   │   ├── scenario/          /api/scenario       Scenario builder items; __init__.py mounts one sub-router per kind
│   │   │   │   └── building_blocks.py /api/scenario/building-blocks  list/create/replace/delete what-if building blocks
│   │   │   └── promotions.py      /api/promotions     promotion CRUD + /health/db
│   │   ├── schemas/               Pydantic v2 request models (only catalog + promotions today)
│   │   │   ├── catalog.py         _Base, normalise_name (retailer names → lowercase slugs), clean_customer_name
│   │   │   │                      (customer names keep their capitals, spaces → _), CustomerCreate/Update,
│   │   │   │                      RetailerCreate (needs customer_id)/Update/Link, StoreCreate/Update,
│   │   │   │                      SkuItem + required SkuCreate/Update
│   │   │   ├── inventory.py       InventoryRecordCreate/Update, ShippedSoFarUpdate
│   │   │   ├── scenario/building_blocks.py ScenarioBuildingBlockCreate/Update (uplift_mode pct|units, signed uplift: pct -100..+50, whole units, never 0; first-of-month range)
│   │   │   ├── settings/doh.py    DohThresholdsUpdate (min <= target <= max, NUMERIC(6,2)), DohAlertUpdate
│   │   │   └── promotions.py      PromoType Literal, PromotionStoreRef, PromotionBase/Create/Update
│   │   └── services/              All logic + all external I/O. Never imports fastapi.
│   │       ├── sql.py             Cloud SQL connector → SQLAlchemy Engine singletons (rw + autocommit read)
│   │       ├── auth_service.py    Google OIDC exchange, shop-aire.com checks, signed sessions
│   │       ├── inventory_calc.py  PURE: ending-stock chain, DOH, DOH threshold status (band from DOH settings), sell-in plan
│   │       ├── inventory_service.py inventory_metrics reads/writes + DOH thresholds via settings/doh (history by month) (raw SQL, one txn per write)
│   │       ├── settings/common.py shared by every kind of setting: engines, CustomerNotFoundError, lock_customer
│   │       ├── settings/doh.py    doh_settings (append-only versions) + customers alert columns; reads via the current_settings view; GLOBAL_DEFAULT_*_DOH 25/30/35
│   │       ├── scenario/common.py engines shared by every kind of Scenario builder item
│   │       ├── scenario/building_blocks.py scenario_building_blocks CRUD; resolves customer_name/product_name to customer_id/sku
│   │       ├── sellout_units.py   Cloud SQL monthly sell-out per SKU for inventory, via sellout_service's effective-sellout view
│   │       ├── forecast_units.py  read-only BigQuery forecast units per SKU/month, from the aire_forecasting_output view (BQ_FORECAST_OUTPUT_VIEW)
│   │       ├── forecast_cache.py  single-flight + short cache for the Forecast page's BigQuery reads (kept until output_built_at changes, or 10 min)
│   │       ├── catalog_service.py retailers/stores/skus CRUD; SKU history/archive; get_or_create_* seams; retailer
│   │       │                      writes for the Customers page (always under a customer, blocked once it has stores)
│   │       ├── customer_service.py customers CRUD + list_customers (customers with nested retailers, in_use flags,
│   │       │                      unlinked retailers); a customer can always be renamed (linked by id), one with data can't be deleted
│   │       ├── promotion_service.py promotions + promotion_stores + promotion_skus, raw SQL, one txn per write
│   │       ├── promotion_pricing.py read-only estimated revenue for a blank-revenue sell-out row: SKU price on each sale
│   │       │                      day, less the promotion mechanic and voucher (POST /api/promotions/revenue-estimate)
│   │       ├── ingestion_service.py upload-run audit + append-only sell-out versions; atomically rolls back bad uploads
│   │       ├── sellout_service.py Cloud SQL `sellout`: ingestion writes, plus the Sales Dashboard reads (SKU ranking,
│   │       │                      dashboard summary, period comparison, options, freshness) that used to go through
│   │       │                      BigQuery -- reads Cloud SQL directly now (no replication lag), and both this and
│   │       │                      sellout_units.py prefer monthly-granularity rows over weekly ones for the same
│   │       │                      retailer+month when both exist (EFFECTIVE_SELLOUT_CTE). A blank revenue takes its
│   │       │                      promotion_pricing estimate, bound per read as :revenue_estimates (never stored),
│   │       │                      and units x current SKU price only when it has none
│   │       ├── bigquery.py        Forecast reads only (get_forecast_output_rows, get_realised_prices, get_forecast_actuals,
│   │       │                      get_forecast_options, get_sales_loaded_at) + get_bigquery_client; the Sales Dashboard
│   │       │                      functions that used to live here moved to sellout_service.py
│   │       ├── storage.py         GCS: upload files (duplicate detection), mapping JSON packets
│   │       ├── upload_check.py    Read-only pre-upload check (POST /api/uploads/check): duplicate + mapping preview, no writes, no model call
│   │       ├── upload_loading.py  Loading uploads into sell-out as its own confirmed step: per-upload load state after an approval,
│   │       │                      dry run (rows, periods, rows replaced/overwritten) and the load itself (POST /api/uploads/load[/preview])
│   │       ├── layout_detection.py PURE: finds the data table in an upload (sheet not a pivot, header row, preamble +
│   │       │                      stated period, cells above the header by column, footer/total rows (and summary
│   │       │                      lines under a total), total + spacer columns, merged cells filled down)
│   │       ├── column_profile.py  PURE: whole-file column profile, repeated period/outlet column groups, template fingerprint
│   │       ├── mapping_contract.py PURE: the contract -- instructions only: one entry per target field (mapped/derived/
│   │       │                      constant/system/not_available), layout, aggregate (monthly roll-up), sku code table,
│   │       │                      melt-group labels (cells above the header, e.g. store codes), period from the stated
│   │       │                      period (from_layout), multiply (units x unit price); read_contract, validate_contract,
│   │       │                      required fields, reviewer diff
│   │       ├── generate_mapping.py Confirmed-contract lookup (ordered template fingerprint), near-match, Gemini proposal with
│   │       │                      check-and-repair loop for unknown layouts
│   │       ├── mapping_prompt.py  PURE: field definitions, glossary, per-file JSON output schema, prompt text
│   │       ├── mapping_checks.py  PURE: static checks of a contract against its file (never runs it): every product code a
│   │       │                      master SKU, required fields, rule coverage, revenue-name guard, stated period, labels;
│   │       │                      confidence
│   │       ├── reference_contracts.py Hand-written contracts for FairPrice (monthly, weekly) / NHG / Sheng Siong / SingHealth /
│   │       │                      Prime (golden tests, eval; `prompt_example` ones are prompt examples)
│   │       ├── mapping_view.py    Contracts <-> the review screen's "packet"/"rules" shape (one rule per target field)
│   │       ├── apply_contract.py  Deterministic transformation executor for mapping contracts
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
    │   │   ├── layout/            AppShell (sidebar + content), PageLayout (title + column; on navigation its heading and cards
    │   │   │                      spring in one by one via PageTransition → lib/cardCascade.js, timing and the card selector in
    │   │   │                      app/config/transitions.js), Sidebar (NAV_ITEMS; collapses
    │   │   │                      to an icon rail, hidden on narrow screens), RailFlyout (a rail section's sub-pages)
    │   │   ├── ui/                shadcn primitives: button, card, tabs, chart, switch, calendar (brand-styled), popover;
    │   │   │                      date kit on calendar: DatePicker (one day) / RangeDatePicker (start + end, Apply), each
    │   │   │                      `variant` button or typed input (utils/datePicker.js); DateRangePicker (older typed
    │   │   │                      From/To pair, exports DateInput, the dd/mm/yyyy box); ChartLoading (spinner placeholder / refetch overlay)
    │   │   │                      and chart skeletons (first-load placeholders on ui/skeleton): ChartSkeletonFrame (shared
    │   │   │                      axes/gridlines/legend/status, `tiltXTicks` for angled labels) → BarChartSkeleton (`groups` per category),
    │   │   │                      LineChartSkeleton (`lines`, `points`; paths from utils/chartSkeleton.js; forecast first load);
    │   │   │                      page skeleton kit: PageSkeleton (one busy status, children inert) holding CardSkeleton (card frame +
    │   │   │                      header bars) + SkeletonBars, chart skeletons and DataTable's first-load state (scenario/ScenarioBuilderSkeleton is the model); MonthGrid (year + 12-month grid, shared by
    │   │   │                      MonthDropdown and the dashboard month-range picker); dropdown kit: Dropdown (the one shell:
    │   │   │                      closed button, popover panel, optional `searchable`, `look` field/filter/compact) →
    │   │   │                      SelectDropdown (pick one, ✓ rows), MultiSelectDropdown (pick many, tick-box rows + "All",
    │   │   │                      `noneMeansAll`), MonthDropdown (one 'YYYY-MM' month, wrapped by promotions MonthPicker and
    │   │   │                      inventory MonthFilter); build new pickers on these, not on a raw Popover; TabTransition (on each tab
    │   │   │                      switch the shown panel's cards spring in one by one, without remounting: Inventory, Scenario builder); toggle kit: SegmentedControl
    │   │   │                      (pick one of a few, sliding highlight, `look` tint/outline), ToggleButton (one thing on/off,
    │   │   │                      `look` compact/chip), ToggleField (switch; `label` / `showState` / hints opt in, `ariaLabel` when unlabelled; used by DOH alerts and nomenclature file settings); app/testing shows both kits and the brand-coloured Button (default/outline/secondary/ghost/destructive/destructive-outline/link/scenario; sizes sm/default/lg) and lists the
    │   │   │                      pages not migrated yet; HeaderCheckboxFilter (table-header pill
    │   │   │                      filter, forecast + inventory tables); formStyles.js (cream form input/label/button classes
    │   │   │                      shared by forms and dialogs); Toast (+ hooks/useToast);
    │   │   │                      list-table kit (Customers, Promotions, SKUs, Nomenclatures): DataTable (card: count, search slot,
    │   │   │                      refresh, Retry, empty state, footer) → TableGrid (column config → fixed widths, sort headers,
    │   │   │                      skeleton; `nested` variant + `inset` for tables inside rows), ExpandableRow, RowActions
    │   │   │                      ("..." menu, disabledReason), StatusPill (success/info/muted/warning/danger); + hooks/useExpandedRows,
    │   │   │                      hooks/useConfirmAction; filter kit (Promotions, SKUs, Nomenclatures): FilterBar (card + grid +
    │   │   │                      Reset) holding FilterSelect (single pick) / MultiSelectDropdown (tick-box) / PriceRangeFilter
    │   │   │                      (min/max popover on Dropdown, text from utils/priceRange.js), whose closed look
    │   │   │                      comes from filterControl.js (filterControlClass)
    │   │   ├── dashboard/         ChannelSwitch (Offline / Online, top right of the trend card), DashboardFilters,
    │   │   │                      CustomerSelector, FilterBadge, PeriodControls (Period /
    │   │   │                      Compare to: DateRangeControl, CompareControl, MonthRangeCalendar — whole months only),
    │   │   │                      RevenueTrendCard (always by format) → TrendChart (FormatTrendChart),
    │   │   │                      ComparisonMixChart (paired stacks; past 6 buckets → ComparisonLineChart: this period
    │   │   │                      solid, comparison dashed), both hovering ComparisonTooltip (per-format breakdown);
    │   │   │                      MonthAxis (month labels + dividers under a long week run);
    │   │   │                      PeriodTexture (hatched "past period" fills), TooltipChange,
    │   │   │                      PeriodComparisonDetail, RevenueSummaryCards + FormatMixBar, SkuRanking;
    │   │   │                      CustomerTrendChart (2+ customers: grouped bars, lines past the bar limit in utils/chartKind.js);
    │   │   │                      DashboardStatus (whole-page card: sales data couldn't load / none uploaded yet)
    │   │   ├── promotions/        PromotionForm, PromotionList → PromotionRow (on ui/DataTable), columns.js, MonthPicker (on ui/MonthDropdown)
    │   │   ├── customers/         CustomersView (state), CustomerTable → CustomerRow (expandable, retailers inside),
    │   │   │                      RetailerTable (nested TableGrid), columns.js (shared grid), NameFormDialog,
    │   │   │                      LinkRetailerDialog, UnlinkedRetailers
    │   │   ├── skus/              SKU catalog filters/table, create-edit form, details/history
    │   │   ├── mappings/          Nomenclature list: MappingList (state) → MappingFilters (on ui/FilterBar), MappingRow (on
    │   │   │                      ui/DataTable), columns.js; plus the review screen (MappingReviewPanel and its steps)
    │   │   ├── forecast/          ForecastChart/Filters/Table
    │   ├── services/              Backend API wrappers
    │   │   ├── promotionsApi.js   request() + parseApiError() + promotion/retailer/store endpoints
    │   │   ├── catalogApi.js      SKU CRUD, details, options and archive API wrappers
    │   │   ├── forecastApi.js     getForecastRows/Options, own request() (no baseUrl arg)
    │   │   ├── settings/          DohSettingsView (state), DohSettingsTable, DohThresholdForm
    │   │   ├── upload/            FileUpload (925 lines), MappingReview, FileUploadSummary (empty)
    │   │   └── upload2/           Harness pieces: MappingDiv, UploadPanel, ResultsPanel, ContractView, RequestLog…
    │   │   ├── salesApi.js        /api/sales wrappers via request() (getSkuSales, getMonthlyOnly)
    │   │   ├── settingsApi.js     /api/settings/* wrappers, one section per kind (reuses promotionsApi.request)
    │   │   ├── scenarioBuildingBlocksApi.js /api/scenario/building-blocks wrappers (reuses promotionsApi.request)
    │   │   ├── catalogApi.js      /api/catalog customers + retailer writes for the Customers page (reuses promotionsApi.request)
    │   │   └── mappingApi.js      /api/uploads wrappers taking an explicit baseUrl (harness style)
    │   └── utils/                 Pure, React-free helpers
    │       ├── promotionForm.js   PROMO_TYPES, EMPTY_PROMOTION_FORM, validate/build/formFrom helpers
    │       ├── skuForm.js         required-field validation and SKU form/payload conversion
    │       ├── skuFilters.js      SKU catalog filtering (multi-select range/brand, min/max price, search)
    │       ├── promotionOverview.js list grouping/filter helpers
    │       ├── forecastView.js    Sell-out run series (Initial Yearly Forecast/Previous/Current), tier resolution
    │       ├── forecastActuals.js PURE: actual_status per month (missing / partial / real 0), Actual line joins, Initial/Previous coverage
    │       ├── forecastYearTotals.js PURE: year cards, actual-or-Current chosen per customer x SKU x month (never per month)
    │       ├── scenarioPlan.js    Monthly plan rows: last year, model, blocks, adjusted, variance; shiftMonth()
    │       ├── dateRange.js       currentYearDateRange() -- shared default-date-range helper
    │       ├── periodComparison.js Compare-to baselines (comparisonSetup), week pairing for the comparison chart
    │       ├── dateRangePresets.js Period presets in whole months (Latest month … Past 12 months, YTD, Last year), anchored to the latest loaded month
    │       ├── trendChart.js      Trend chart labels, x-axis setup (long week runs grouped by month: weekMonthGroups → dashboard/MonthAxis),
    │       │                      y-axis (metricYAxisProps, chartDataRange; dips below 0 for negative sales), bar sizing, format stack order, Revenue/Volume formatting
    │       ├── axisTicks.js       PURE, import-free: y-axis tick labels, one unit (k / M) and one decimal count per axis (tests/axisTicks.test.mjs)
    │       ├── weeklyGaps.js      "No weekly data for …" message: monthly-only months merged into ranges, capped
    │       ├── priceMix.js        Avg-price change split into SKU price vs product mix
    │       ├── estimatedRevenue.js est. sign: when a revenue figure includes estimated revenue, and its hover text
    │       ├── customerTrend.js   Cross-customer chart: series/rows (any number of customers)
    │       ├── chartKind.js       PURE, import-free: bars vs lines for the trend charts -- customers x periods over 12 (desktop) / 3 (phone) → lines, one period always bars (tests/chartKind.test.mjs)
    │       ├── storeFormats.js    FORMAT_COLORS + formatColor() per store format; customerColor + customerColorOrder (one colour per customer on every page, by customer_id)
    │       ├── dohSettingsForm.js validate/build/formFrom helpers for the DOH threshold form, GLOBAL_DEFAULT_DOH
    │       ├── customerForm.js    normaliseName / cleanCustomerName (mirror backend), validateName, edit/delete block reasons
    │       ├── retailerLabel.js   shared display labels: retailerLabel (fairprice_online → Fairprice Online), customerLabel (Sheng_Shiong → Sheng Shiong, capitals as typed)
    │       └── mappingHelpers.js
    ├── proxy.js                   Optimistic route guard: missing session cookie → /login
    ├── hooks/                     Data-fetching hooks (cancel-flag pattern; dashboard calls services/*Api.js)
    │   ├── useDataFreshness.js    polls /api/sales/last-updated → { channels, dataVersion, refreshing }
    │   ├── useCustomerOptions.js  /api/sales/customer-options
    │   ├── useAllCustomers.js     /api/inventory/customers via inventoryApi (every customer, for customerColorOrder)
    │   ├── useCustomerTrends.js   /api/sales/customer-trends via salesApi.getCustomerTrends (2-3 customers ticked: each per week/month)
    │   ├── useDashboardSummary.js /api/sales/dashboard-summary (silent refresh on dataVersion)
    │   ├── useDefaultDateRange.js /api/sales/default-date-range
    │   ├── useSkuSales.js         /api/sales/skus via salesApi.getSkuSales
    │   ├── useMonthlyOnly.js      /api/sales/monthly-only via salesApi.getMonthlyOnly (months with no weekly breakdown → month bars)
    │   ├── usePriceMix.js         useSkuSales × 2 (this period + comparison) → priceMixEffects
    │   ├── useDohSettings.js      /api/settings/doh (+ replaceRow for the row a write returns)
    │   ├── useUploads.js          upload list + actions from components/upload/UploadProvider (in the root layout, so uploads outlive the page; UploadTray shows them on every page)
    │   ├── useCustomers.js        /api/catalog/customers (+ applyCustomer / removeCustomer for the row a write returns)
    │   ├── useExpandedRows.js     { isExpanded, toggle, expand } for ui/ExpandableRow (several open by default)
    │   ├── useConfirmAction.js    { target, isPending, request, cancel, confirm } for ui/ConfirmDialog (e.g. Delete)
    │   ├── useMediaQuery.js       boolean for a CSS media query (Sidebar: rail vs hidden when collapsed)
    │   ├── useDelayedLoading.js   { pending, visible, placeholderClass }: a first-load chart skeleton shows only after 200ms and
    │   │                          stays 400ms, so fast loads never flash it (dashboard trend, forecast, InventoryChartSlot)
    │   ├── useChartTransition.js  tweens a chart's rows and y-axis range together on a change (pure blending in
    │   │                          utils/chartTransition.js), so bars/lines, gridlines and tick labels move on one scale;
    │   │                          every dashboard/forecast/inventory chart except ComparisonMixChart (animation off by design)
    │   └── useToast.js            { toast, notify, dismissToast } for components/ui/Toast
    ├── lib/                       cn() (clsx + tailwind-merge), formatDateRange, formatDate/formatDateTime (shared date display,
    │                              Singapore time), singaporeTime (singaporeDateTimeParts, singaporeToday), cardCascade
    │                              (springs a container's cards in one by one; PageTransition, TabTransition)
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
No test framework is installed on the frontend: `npm run lint` is the main check, and `npm test` runs
Node's built-in test runner (`node --test`, no packages) over `tests/*.test.mjs` for pure `app/utils/` helpers.

---

## 2. Domains and their backing stores

| Domain | Router | Service(s) | Storage | Frontend entry |
| --- | --- | --- | --- | --- |
| Authentication | `auth.py` | `auth_service`, shared `app.auth.require_user` dependency | Google Workspace OIDC; signed HTTP-only `aireos_session` cookie (no application password store) | `app/login`, root `proxy.js` |
| Upload & mapping | `uploads.py`, `mappings.py` | Generation: `layout_detection`, `column_profile`, `generate_mapping`, `mapping_prompt`, `mapping_contract`, `mapping_checks`, `mapping_view`. Transformation: `sellout_ingestion`, `apply_contract`, `validation_service`; rollback: `ingestion_service` | **GCS** bucket: `uploads/` files, `mappings/pending/<fp>.json`, `mappings/confirmed/<fp>.json`, `mappings/history/<fp>/v<n>.json`. **Cloud SQL**: `skus` read-only during mapping checks; `ingestion_runs` + append-only `sellout_versions` audit transformed uploads and restore prior `sellout` values | `app/upload`, `app/mappings`, `services/mappingApi.js` |
| Sales dashboard | `sales.py` | `sellout_service` | **Cloud SQL Postgres**: `sellout` (the source of truth -- every upload writes here first; `retailer_id`/`store_code`/`sku` rows, `period_type` `week` or `month`), joined to `retailers`/`stores`/`skus` for names (retailer name = `{customer}_{offline|online}`). A retailer+calendar-month with monthly-granularity rows uses only those (never both, see `EFFECTIVE_SELLOUT_CTE`); `granularity='week'` summary views read genuine weekly rows only. No more BigQuery/Datastream replication lag -- reads are real-time | `app/dashboard`, `hooks/use*.js`, `services/salesApi.js` |
| Catalog | `catalog.py` | `catalog_service`, `customer_service` | **Cloud SQL Postgres**: `customers`, `customer_retailers`, `retailers`, `stores`, `skus`, `sku_history`. Retailer names are lowercase slugs; customer names keep the capitals they were typed with (`FairPrice`, `Sheng_Shiong`); both unique case-insensitively. A retailer with stores, or a customer with any such retailer or `inventory_metrics` rows, is `in_use` and can't be deleted (nor, for a retailer, renamed). A customer can always be renamed: everything links to it by id, its retailers keep their slug names, and the dashboard labels a retailer family with its owning customer's name (`sellout_service._customer_label`). `skus` keeps one stable foreign-key master row per code; `sku_history` stores its timestamped created/updated/archived versions. Historical price reads resolve the version effective on the requested date. | `app/customers`, `app/skus`, `services/catalogApi.js`; `services/promotionsApi.js` (getRetailers/getStores/getSkuRanges) |
| Inventory | `inventory.py` | `inventory_service`, `inventory_calc`, `sellout_units`, `forecast_units` | **Cloud SQL Postgres**: `customers`, `customer_retailers`, `inventory_metrics` (long format; app writes carry `data_source='manual_entry'`; only sell-in, a first-month opening and building blocks (stock used outside sell-out) are read; workbook rows are never changed), `doh_settings` (read via `settings/doh.fetch_versions`; closed months use the version in effect at month end, the latest month, at-risk list and sell-in plan use the current one), `sellout` (sell-out, via `sellout_units`/`sellout_service`'s effective-sellout view, same monthly-preferred-over-weekly rule as the dashboard); **BigQuery** (read-only): the forecast table. Ending stock, DOH and the plan are computed, never stored | `app/inventory`, `services/inventoryApi.js` |
| Scenario builder | `scenario/building_blocks.py` (`/api/scenario/building-blocks`) | `scenario/building_blocks`, `scenario/common` | **Cloud SQL Postgres**: `scenario_building_blocks` (what-if uplifts stored as entered: `uplift_mode` `pct` = % on Current each month, `units` = whole units over the whole range; a negative value is a decrease (a flood, a store closing; migration `014_scenario_building_blocks_decrease.sql`), and the Simulated line is floored at 0 per customer x SKU x month (`scenarioEngine.simulate`); `is_active` decides whether a block counts; `customer_id` ON DELETE CASCADE, `sku` NULL = all SKUs). Only the Scenario builder's Simulated line reads it -- the Current forecast, Inventory and Dashboard never do; the delta is worked out on the client (`scenarioEngine.js`), in units only -- the Scenario builder never predicts revenue, since a discount's price effect isn't modelled. Not the same as inventory's `sell_out_building_blocks` (confirmed blocks that count as actuals) | `app/scenario`, `services/scenarioBuildingBlocksApi.js` |
| Settings (DOH) | `settings/doh.py` | `settings/doh`, `settings/common` | **Cloud SQL Postgres**: `doh_settings` (append-only: a change is an INSERT only when min/target/max differ from the newest row; newest by `updated_at DESC, setting_id DESC`; never UPDATE/DELETE, except that a new customer gets a global-default row; `customer_id` is ON DELETE CASCADE, so deleting a customer deletes its rows and DOH settings never block it), view `current_settings` (one row per customer), `customers.doh_alert_enabled` / `doh_alert_updated_at` (in-place toggle, no version). Also read by the inventory DOH calculations (`fetch_versions`, `thresholds_on`, `current_thresholds`) | `app/doh`, `services/settingsApi.js` |
| Promotions | `promotions.py` | `promotion_service` (+ `catalog_service` seams) | **Cloud SQL Postgres**: `promotions`, `promotion_stores`, `promotion_skus`; enum `promo_type_enum`; trigger `trg_promotions_updated_at` | `app/promotions`, `services/promotionsApi.js` |
| Forecast (P&L) | `forecast.py` (`/api/forecast`, read-only; writes are out of band via `scripts/refresh_forecast.py`) | `pl_forecast` (pure), `forecast_service`, `catalog_service` (product prices) | **BigQuery** (`BQ_FORECAST_DATASET`, default `aireos_forecast_validation_sg`, read-only; names from `BQ_CDC_DATASET`): model learns from `v_sales_enriched` (weekly), page Actual line reads `v_customer_monthly_sales`; refresh MERGEs into `BQ_FORECAST_TABLE`. **Cloud SQL Postgres**: `skus.price` prices sell-out revenue | `app/forecast` |
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
| `sellout_service.get_customer_trends` (`/api/sales/customer-trends`: `customers[]` with `offline`/`online` period lists, `has_*`; no cap on customers) | `salesApi.getCustomerTrends`, `useCustomerTrends.js`, `utils/customerTrend.js`, `utils/chartKind.js` (`MAX_BARS_DESKTOP`/`MAX_BARS_MOBILE`), `CustomerTrendChart.jsx`, `CustomerSelector.jsx` |
| `sellout_service` estimated part of revenue: `estimated_revenue` (dashboard summary rows, customer totals), `estimated_value` (SKU ranking), from the `revenue_estimated` row flag | `utils/estimatedRevenue.js`, `EstMark.jsx` (top right of each `RevenueSummaryCards` tile, beside `SkuRanking` values; `TrendChart` tooltip) |
| `mapping_view` packet/rule keys (`targetField`, `sourceColumn`, `editable`, `status`, `field`, `meltGroup`, `options`, `description`, `requiredMissing`, `checks`) | `utils/mappingReview.js`, `components/mappings/*` |
| `mapping_checks` check shape (`id`, `level`, `passed`, `message`, `fields`, `evidence`) | `utils/mappingChecks.js`, `MappingChecks.jsx` |
| packet `skuCodes`, `masterSkus`, `contractFormat`, `instructions`; processing preview/rejection fields | `utils/skuCodeTable.js`, `SkuCodeTable.jsx`, `MappingReviewPanel.jsx`, `UploadFileRow.jsx` |
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
| `GET /api/settings/promo-uplifts/moments` (`settings/promo_moments.list_moments`, rules in `settings/promo_moment_rules.py`): `moments[]` (`customer_name`, `sku`, `sku_range`, `month`, `mechanic_key`, `uplift_pct`, `is_baseline`), `recommendations[]` (`recommended_uplift_pct`, `moments_by_year`, `months_used`, `enough_data`), `recommend_from` | `promoUpliftSettings.js` (`momentCounts`, `formatMomentCounts`, `recommendedUplift` -- `latestMonth` from `months_used` is the Effective date), `PromoUpliftTable.jsx` (Moments, Effective date columns), `hooks/usePromoMoments.js` |
| `settings/promo_uplifts` anchors per customer x SKU range, a mechanic saved once and changed only by adopting a recommendation (`list_anchors` `window_months`, `recommend_from`, `customers[].ranges[]`: `sku_range`, `anchor_pct`, `mechanic_label`, `source` `recommended`/`manual`/`customer`/`default`, `recommended`, `recommendation_differs`, `manual_allowed`; PUT (typed discount, 409 unless too few moments) and POST `/adopt` take `sku_range`, history `?sku_range=`; `seed_anchors`); `resolve_uplifts` `product_uplifts` + `product_anchors`; migrations `012_create_promo_uplift_settings.sql` + `013_promo_anchor_mechanic.sql` (append-only, newest row per target wins) | `settingsApi.js` anchor wrappers (via `promoUpliftsApi.js`), `PromoAnchorTable.jsx`, `PromoAnchorDetails.jsx`, `PromoAnchorForm.jsx`, `PromoUpliftSettingsView.shownUplift`, `scenario/PromotionEditor.jsx` |
| `forecast_notifications` payload (`run_name`, `source` event/scheduled/script, `stage` pipeline/refresh, `reason`, `errors`, `warnings` (a success whose Initial couldn't refresh: `initial_refresh_warning`), `period_*`, `customers`, `skus`, `updated_at`) | `utils/forecastNotificationText.js`, `NotificationPanel.jsx` |
| `assistant._FORECAST_LINES` (keys, labels, export colours; `chart_series[].key`/`unit`), `forecast_summary` `chart_lines` | `FORECAST_SERIES` in `utils/forecastView.js`, `AssistantChart` in `assistant/AssistantMessage.jsx` |
| `GET /api/forecast` rows: one per customer x SKU x month x **tier** (`bigquery.FORECAST_TIERS`, `FORECAST_OUTPUT_COLUMNS`: `tier`/`tier_label`/`tier_order`, `is_available`/`unavailable_reason`, `month_range_pct`/`month_confidence_band`, `previous_low_80`/`previous_high_80` (Previous's own run row in `aire_forecasting_runs`, joined on `previous_generated_at` + `source_model`; the view has none) with `previous_range_pct`/`previous_confidence_band` (`bigquery.month_range`, the view's 20/50 cut-offs), payload `horizon` `{tier: {units, series}}` (each series' whole Current line with no date filter, `bigquery.get_current_horizon` + `forecast_service.current_horizon_totals`: the "Next 12 months" strip). The Forecast page is **volume only**: rows and actuals carry no revenue and nothing is priced (`add_forecast_revenue` / `get_realised_prices` remain for the assistant's `forecast_summary` and `/alternatives`), `xreg_used_typical_promo`, `actual_status` (`reported`/`missing_file`/`not_yet`/`before_first_sale`, `bigquery.ACTUAL_STATUSES`), `output_built_at`); actuals rows carry `sku`; `availability` `{sku: {tier: {is_available, unavailable_reason, has_initial, has_previous}}}`, `tiers`, `freshness.by_tier` + `freshness.output_built_at` (`forecast_service.forecast_availability` / `forecast_tiers_from_rows` / `forecast_stamps_from_rows`). Never add rows of different tiers: `forecast_units`, `forecast_summary` and every `getForecastView` caller but /forecast use Tier 0. The Forecast page's output-table reads go through `bigquery.cached_read` (`forecast_cache`: single-flight, kept until `output_built_at` changes or 10 min; no time limit) | `forecastApi.getForecastView` (`tier`, default Tier 0; `ALL_TIERS` on /forecast), `utils/forecastTiers.js` (`forecastModelView`: the selected tier for one customer and All customers alike, never an average), `utils/forecastActuals.js` (missing / partial / real-0 actuals from `actual_status`, Actual line joins, Initial/Previous coverage per customer x SKU), `FORECAST_TIER_OPTIONS` / `UNAVAILABLE_REASON_TEXT` in `utils/forecastLineText.js`, `ForecastFilters` Model field, `ForecastConfidenceDetails.jsx`, `?tier=` on `app/forecast/page.js` |
| `GET /api/forecast/initial-status` (`forecast_service.get_initial_status`: `years[]` of `forecast_year`, `lock_at`, `refreshed_at`, `locked`, from `aire_forecasting_initial_meta`; best effort, `[]` on error) | `forecastApi.getForecastInitialStatus`, `hooks/useForecastInitialStatus.js`, `utils/forecastLineText.js` (`initialStatusNotes`), `ForecastLegendFooter.jsx` |
| `GET /api/forecast/refresh-status` (`forecast_refresh_worker.refresh_status_best_effort`: `{ updating, since }` from pending/running `forecast_refresh_requests`; false on error or while event refresh is off) | `forecastApi.getForecastRefreshStatus`, `hooks/useForecastRefreshStatus.js` (60 s re-check only while updating), `utils/forecastLineText.js` (`forecastUpdatingBadge`, `nextStatusCheckDelay`), `ForecastLegendFooter.jsx` |
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
`BQ_FORECAST_DATASET` (default `aireos_forecast_validation_sg`: the forecast views and pipeline tables), `BQ_CDC_DATASET` (default `aireos_cdc_sg`: Datastream's `public_customers` / `public_skus`, the names the forecast is joined to), `BQ_FORECAST_LOCATION`, `BQ_FAIRPRICESELLOUT_TABLE` (legacy, unused), `BQ_FORECAST_OUTPUT_VIEW`, `MAPPING_MODEL`, `MAPPING_VERTEX_LOCATION`,
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
Tests: `cd backend && pytest`; `cd frontend/aireos && npm test`. Lint: `cd frontend/aireos && npm run lint`.

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
