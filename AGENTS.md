# agents.md — Architecture & Context Map for aireOS

This is the map. [claude.md](claude.md) is the rulebook. Read this before touching code so
you know which folder owns a concern, how data moves, and which "hat" to wear.

aireOS (Team WIP × Aire, final-year project) is an internal operations tool for a diaper/
personal-care brand selling through retailers (FairPrice first). It ingests retailer sellout
spreadsheets, shows a sales dashboard, manages promotion events, and tracks inventory (ending
stock, days of holding, DOH thresholds, a sell-in plan). Forecast is a placeholder route.

---

## 1. Repository layout

```
aireOS/
├── .github/workflows/ci.yml       CI: backend pytest only (Python 3.11, no cloud creds)
├── .vscode/tasks.json             "Start Both Servers" task (uvicorn + next dev)
├── README.md                      Setup + the mapping workflow explanation
├── claude.md / agents.md          These files
│
├── backend/                       FastAPI app — run: uvicorn app.main:app --reload (:8000)
│   ├── app/
│   │   ├── main.py                FastAPI() instance, CORS (dev: allow all), include_router × 4, GET /
│   │   ├── routers/               HTTP layer. One file per URL prefix.
│   │   │   ├── uploads.py         /api/uploads        file ingest + mapping review (async)
│   │   │   ├── sales.py           /api/sales          BigQuery dashboard reads
│   │   │   ├── catalog.py         /api/catalog        retailer/store CRUD, sku-range lookup
│   │   │   ├── inventory.py       /api/inventory      overview, per-customer DOH, at-risk list, sell-in plan, record create/edit, temporary sell-in
│   │   │   └── promotions.py      /api/promotions     promotion CRUD + /health/db
│   │   ├── schemas/               Pydantic v2 request models (only catalog + promotions today)
│   │   │   ├── catalog.py         _Base, RetailerCreate/Update, StoreCreate/Update, SkuItem
│   │   │   ├── inventory.py       InventoryRecordCreate/Update, ShippedSoFarUpdate
│   │   │   └── promotions.py      PromoType Literal, PromotionStoreRef, PromotionBase/Create/Update
│   │   └── services/              All logic + all external I/O. Never imports fastapi.
│   │       ├── sql.py             Cloud SQL connector → SQLAlchemy Engine singletons (rw + autocommit read)
│   │       ├── inventory_calc.py  PURE: ending-stock chain, DOH, DOH threshold band/status, sell-in plan
│   │       ├── inventory_service.py inventory_metrics reads/writes + customer_doh_targets reads (raw SQL, one txn per write)
│   │       ├── sellout_units.py   read-only BigQuery monthly sell-out per SKU (same weekly data as the dashboard)
│   │       ├── forecast_units.py  read-only BigQuery forecast units per product/month, newest run only
│   │       ├── catalog_service.py retailers/stores/skus tables; get_or_create_* seams; domain exceptions
│   │       ├── promotion_service.py promotions + promotion_stores + promotion_skus, raw SQL, one txn per write
│   │       ├── bigquery.py        SKU ranking, dashboard summary, period comparison, options, freshness
│   │       ├── storage.py         GCS: upload files (duplicate detection), mapping JSON packets
│   │       ├── mapping_service.py Built-in deterministic FairPrice "wide" mapping (regex header match, melt)
│   │       ├── generate_mapping.py Claude-generated mapping contracts for unknown layouts; validate_contract
│   │       ├── mapping_view.py    Normalises builtin + stored contracts into one "packet"/"rules" shape for the UI
│   │       ├── apply_contract.py  Applies a confirmed contract (identity_mapping + melt_groups) to a DataFrame
│   │       └── validation_service.py Row-level validation against TARGET_SCHEMA after mapping
│   ├── tests/                     pytest; fakes for BigQuery/GCS clients; no network
│   ├── pytest.ini                 pythonpath=. testpaths=tests
│   ├── requirements.txt           fastapi, uvicorn, pandas, openpyxl, sqlalchemy, cloud-sql-python-connector[pg8000],
│   │                              google-cloud-bigquery, google-cloud-storage, anthropic, python-dotenv, python-multipart
│   ├── .env.backend               (gitignored) GCP + Cloud SQL + Anthropic config — see §4
│   └── gcp-key.json               (gitignored) service-account key
│
└── frontend/aireos/               Next.js 16.3 App Router, React 19.2, JavaScript — run: npm run dev (:3000)
    ├── app/
    │   ├── layout.js              Root layout: DM Sans / DM Serif / Geist Mono fonts, globals.css
    │   ├── page.js                Untouched create-next-app landing page (not linked from nav)
    │   ├── globals.css            Tailwind v4 + shadcn tokens + "AIRE brand kit" CSS vars + .dark
    │   ├── upload/page.js         Production upload + mapping review screen (uses components/upload)
    │   ├── upload2/page.js        Developer "mapping harness" (uses components/upload2, manual API base URL)
    │   ├── dashboard/page.js      Sales dashboard: customer/sku/store/date filters, trend chart, ranking
    │   ├── promotions/page.js     Promotion create/edit/delete + overview list
    │   ├── forecast/page.js       Placeholder
    │   ├── inventory/page.js      Inventory: overview, by-customer DOH, at-risk list, sell-in plan, enter/edit data (components/inventory)
    │   ├── components/
    │   │   ├── layout/            AppShell (sidebar + content), PageLayout (title + column), Sidebar (NAV_ITEMS)
    │   │   ├── ui/                shadcn primitives: button, card, tabs, chart, DateRangePicker
    │   │   ├── dashboard/         DashboardFilters, CustomerSelector, RevenueTrendCard, RevenueSummaryCards,
    │   │   │                      SkuRanking, PeriodComparisonDetail, FilterBadge
    │   │   ├── promotions/        PromotionForm, PromotionList, CheckboxDropdown
    │   │   ├── upload/            FileUpload (925 lines), MappingReview, FileUploadSummary (empty)
    │   │   └── upload2/           Harness pieces: MappingDiv, UploadPanel, ResultsPanel, ContractView, RequestLog…
    │   ├── services/              Backend API wrappers
    │   │   ├── promotionsApi.js   request() + parseApiError() + one fn per /api/promotions & /api/catalog endpoint
    │   │   └── mappingApi.js      /api/uploads wrappers taking an explicit baseUrl (harness style)
    │   └── utils/                 Pure, React-free helpers
    │       ├── promotionForm.js   PROMO_TYPES, EMPTY_PROMOTION_FORM, validate/build/formFrom helpers
    │       ├── promotionOverview.js list grouping/filter helpers
    │       └── mappingHelpers.js
    ├── hooks/                     Data-fetching hooks for the dashboard (inline fetch, cancel-flag pattern)
    │   ├── useDataFreshness.js    polls /api/sales/last-updated → { channels, dataVersion, refreshing }
    │   ├── useCustomerOptions.js  /api/sales/customer-options
    │   ├── useDashboardSummary.js /api/sales/dashboard-summary (silent refresh on dataVersion)
    │   ├── usePeriodComparison.js /api/sales/period-comparison
    │   ├── useDefaultDateRange.js /api/sales/default-date-range
    │   └── useDraftDateRange.js   local draft state for the picker
    ├── lib/                       cn() (clsx + tailwind-merge), formatDateRange
    ├── public/                    create-next-app SVGs
    ├── CONTRIBUTING.md            Frontend UI conventions (primitives, tokens, cn(), lucide) — binding
    ├── CLAUDE.md → @AGENTS.md     Next.js auto-generated notice: read node_modules/next/dist/docs before Next APIs
    ├── components.json            shadcn: style base-nova, rsc true, tsx false, aliases @/components, @/lib, @/hooks
    ├── jsconfig.json              @/components/* → app/components/*, @/* → ./*
    ├── next.config.mjs            reactCompiler: true
    ├── eslint.config.mjs          eslint-config-next/core-web-vitals
    └── .env.local                 (gitignored) NEXT_PUBLIC_API_URL, BACKEND_API_URL
```

Key dependencies: `@base-ui/react`, `shadcn`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `lucide-react`, `recharts`, `tw-animate-css`, `babel-plugin-react-compiler`.
No test runner is installed on the frontend; linting (`npm run lint`) is the frontend check.

---

## 2. Domains and their backing stores

| Domain | Router | Service(s) | Storage | Frontend entry |
| --- | --- | --- | --- | --- |
| Upload & mapping | `uploads.py` | `storage`, `mapping_service`, `generate_mapping`, `mapping_view`, `apply_contract`, `validation_service` | **GCS** bucket: `uploads/` files, `mappings/pending/<fp>.json`, `mappings/confirmed/<fp>.json` | `app/upload`, `app/upload2`, `services/mappingApi.js` |
| Sales dashboard | `sales.py` | `bigquery` | **BigQuery** `aire-data.Aire_Data.aireOS_fairprice` (read-only, weekly rows, retailer = `{customer}_{offline|online}`) | `app/dashboard`, `hooks/use*.js` |
| Catalog | `catalog.py` | `catalog_service` | **Cloud SQL Postgres**: `retailers`, `stores`, `skus` | `services/promotionsApi.js` (getRetailers/getStores/getSkuRanges) |
| Inventory | `inventory.py` | `inventory_service`, `inventory_calc`, `sellout_units`, `forecast_units` | **Cloud SQL Postgres**: `customers`, `customer_retailers`, `inventory_metrics` (long format; app writes carry `data_source='manual_entry'`; only sell-in and a first-month opening are read; workbook rows are never changed), `customer_doh_targets` (effective-dated, read-only from the app); **BigQuery** (read-only): weekly sell-out (`BQ_SELLOUT_TABLE`, default `public_sellout`) and the forecast table. Ending stock, DOH and the plan are computed, never stored | `app/inventory`, `services/inventoryApi.js` |
| Promotions | `promotions.py` | `promotion_service` (+ `catalog_service` seams) | **Cloud SQL Postgres**: `promotions`, `promotion_stores`, `promotion_skus`; enum `promo_type_enum`; trigger `trg_promotions_updated_at` | `app/promotions`, `services/promotionsApi.js` |
| AI mapping | (inside uploads) | `generate_mapping` | **Anthropic API** (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) | — |

Invariants that cross domains:
- Mapping never writes to BigQuery. Ingestion into BigQuery is out of band.
- Promotion writes never insert/update `skus`, `stores`, `retailers` **except** through the
  `get_or_create_retailers/stores` seams (a promotion may name a new store as free text).
- `TARGET_SCHEMA` is defined twice (`mapping_service.py`, `generate_mapping.py`) — keep them in sync.

---

## 3. Data flow and communication patterns

### 3.1 Transport

- Browser → FastAPI over plain `fetch`, JSON bodies, base URL `NEXT_PUBLIC_API_URL`
  (`http://localhost:8000` in dev). No auth, no cookies, no server-side Next.js data fetching —
  every page that loads data is a `'use client'` tree.
- CORS is wide open (`allow_origin_regex=".*"`) in `main.py` — dev only.
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
                                  └─► BigQuery | Cloud SQL | GCS | Anthropic
                             ◄─── dict / list[dict] / DataFrame.to_dict
                        ◄─── JSON (200) or {detail} (4xx/5xx)
                   ◄─── { data, loading, error } state
```

### 3.3 Three concrete flows

**Upload → mapping → review** (`POST /api/uploads`)
1. `FileUpload.jsx` posts files. Router reads every stream once, `asyncio.to_thread(storage.upload_many)`
   (duplicate-filename check unless `force`).
2. Per file, concurrently (`asyncio.gather` → `to_thread(resolve_and_apply_mapping)`):
   read headers → `mapping_service.find_matching_mapping` (built-in FairPrice regex match) →
   if hit: `validation_service.process_and_validate` → `status: "mapped", source: "builtin"`.
   Else `generate_mapping.resolve_mapping`: fingerprint headers → look for
   `mappings/confirmed/<fp>.json` → else ask Claude for a contract → store in
   `mappings/pending/` → `status: "pending_confirmation"`.
3. `MappingReview.jsx` lists `GET /api/uploads/mappings` (every packet normalised by
   `mapping_view`), user edits **rules** (not raw contract), `POST .../{fp}/confirm` with
   `{ rules }` → server rebuilds + re-validates contract → promotes to `confirmed/`.
   `DELETE .../{fp}/pending` discards.

**Dashboard** (`app/dashboard/page.js`)
1. `useDataFreshness` polls `/api/sales/last-updated`; a change bumps `dataVersion`, which every
   other hook lists as a dependency so data silently refreshes.
2. `useCustomerOptions` → first customer auto-selected during render.
3. `useDefaultDateRange` ×4 presets, `useDashboardSummary`, `usePeriodComparison` all take
   `{ customer, sku, store, startDate, endDate, mode, dataVersion }` and hit `/api/sales/*`.
   Each maps to one `bigquery.get_*` function that builds a parameterised query.
4. Long ranges switch `granularity` week→month on the client (`chartGranularity`), passed
   through to the API so both sides of a comparison agree.

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
| `sales.py` query-param names (`start_date`, `granularity`, `comparison_type` …) | `URLSearchParams` keys in `hooks/*.js` |
| `mapping_view` packet/rule keys (`targetField`, `sourceColumn`, `editable`, `requiredMissing`) | `MappingReview.jsx`, `upload2/ContractView.jsx` |
| `uploads.py` per-file `mapping.status` values (`mapped`, `pending_confirmation`, `mapping_failed`) | `FileUpload.jsx` result rendering |
| `HTTPException.detail` shapes | `parseApiError()` |

When you change the left column, grep the right column in the same PR.

---

## 4. Configuration and environment (know the quirks)

Backend env files are loaded in **four places** and not consistently:

| Module | Loads |
| --- | --- |
| `app/main.py` | `backend/.env` |
| `app/services/storage.py` | `backend/.env.backend` ← **the file that actually exists** |
| `app/services/generate_mapping.py` | `backend/.env.local` |
| `app/services/sql.py` | `load_dotenv(backend/)` (a directory — effectively a no-op) |

`backend/README.md` says `.env.local`; reality is `.env.backend`. Because `load_dotenv` never
overrides an already-set variable and `storage.py` is imported by `uploads.py` at startup, the
`.env.backend` values win in practice. Do not add a fifth loader — if you touch this, consolidate
to one `load_dotenv` in `main.py` and update the README.

Backend variables: `GOOGLE_APPLICATION_CREDENTIALS`, `SERVICE_ACCOUNT_KEY_PATH`, `GCP_PROJECT_ID`,
`GCS_BUCKET_NAME`, `GCS_DESTINATION_PREFIX`, `GCS_DESTINATION_PREFIX_MAPPING`,
`BQ_FAIRPRICESELLOUT_TABLE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`POSTGRESQL_INSTANCE_CONNECTION_NAME`, `DB_IAM_USER`, `DB_NAME`.

Frontend variables: `NEXT_PUBLIC_API_URL` (browser-visible, used everywhere), `BACKEND_API_URL`
(present but unused — server-side only if ever needed).

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

### `/backend/app/services/{mapping_service,generate_mapping,mapping_view,apply_contract}` — Data-pipeline engineer
- Think in DataFrames and contracts: `identity_mapping` (source col → target field) and
  `melt_groups` (wide period columns → long rows with `period_start`/`period_end`/`period_type`).
- Built-in FairPrice mapping is deterministic Python and shown read-only; Claude-generated
  contracts are JSON in GCS and always re-validated (`validate_contract`) before being trusted.
- Recognised files must never call the Anthropic API. Keep that ordering in
  `resolve_and_apply_mapping`.
- Prefer pure functions with tiny DataFrame fixtures in tests; no GCS or Anthropic in tests.

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
  changes (the backend README's env-file name is already wrong — see §4).
- CI must stay green and credential-free.
- Conventional Commits; branch `feat/AO<n>-<m>-desc`, `fix/…`, `refactor/…`; PRs to `main`.
- Never commit `gcp-key.json`, `.env*`, or anything under `node_modules/`, `venv/`, `.next/`.

---

## 6. Known debt (don't be surprised by it; don't fix it as a drive-by)

- `app/page.js` is the stock create-next-app landing; nav starts at `/upload`.
- `FileUpload.jsx` and `PromotionList.jsx` are oversized; extract when already editing them.
- Two fetch-wrapper styles (`promotionsApi.request` vs `mappingApi.request(baseUrl, …)`) and
  raw `fetch` in dashboard hooks. New code uses the `promotionsApi` style.
- Inconsistent dotenv loading (§4).
- Backend README lists; actual file is `.env.backend`.
- CI covers backend only.
