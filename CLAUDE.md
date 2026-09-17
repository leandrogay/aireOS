@AGENTS.md
# claude.md — Core Coding Rules for aireOS

These are standing instructions for any AI agent (and any human) writing code in this repo.
Read [agents.md](agents.md) first for the architecture map; this file is the rulebook.

aireOS is a FastAPI (Python 3.11) backend + Next.js 16 App Router (JavaScript, React 19) frontend
for retail sales ingestion, dashboards, and promotion planning, backed by Google Cloud
(BigQuery, Cloud SQL Postgres, Cloud Storage) and the Anthropic API.

---

## 1. Core philosophy

1. **Simple beats clever.** Write the version a teammate can read top-to-bottom in one pass.
   No metaprogramming, no one-liner tricks, no premature abstraction. If a comment is needed
   to explain *how* code works, rewrite the code; comments in this repo explain *why*.
2. **Small, focused units.** One module = one concern (`storage.py` talks to GCS, `bigquery.py`
   to BigQuery, `promotion_service.py` to the promotions tables). One function = one job.
   Split helpers out as soon as a function does two things (`_resolve_store_ids`,
   `_catalog_skus_for_items` are the model).
3. **Reuse before you write.** Check for an existing helper, hook, primitive, or schema before
   adding one. Existing seams to reuse:
   - Backend: `_Base` in `app/schemas/catalog.py`, `get_or_create_retailer/store` in
     `catalog_service.py`, `sql.connect_with_connector*()`, `storage.upload_json/download_json`,
     `_validate_date` in `bigquery.py`.
   - Frontend: `request()`/`parseApiError()` in `app/services/promotionsApi.js`, `cn()` in
     `lib/utils.js`, `PageLayout`, the `ui/` primitives, `hooks/use*.js`.
4. **Match the surrounding code.** Comment density, naming, section banners
   (`# ====` in Python, `// ====` in JS), quote style (single quotes in JS), and the existing
   file layout all take precedence over personal preference.
5. **Don't drive-by refactor.** Migrate old code only when you are already in that file for
   other work (this is the rule in `frontend/aireos/CONTRIBUTING.md` and it applies stack-wide).
6. **Never touch master data or sales tables from a feature change.** `skus`, `stores`,
   `retailers` are catalog master data; BigQuery sellout tables are read-only reference data.
   Mapping contracts live in GCS as JSON, never in BigQuery.

---

## 2. Backend (FastAPI) rules

### 2.1 Layering — routers → schemas → services

```
app/routers/*.py    HTTP only: parse request, call one service function, map exceptions → HTTPException
app/schemas/*.py    Pydantic v2 request models. Validation lives here, not in routers.
app/services/*.py   All business logic and every external call (SQL, BigQuery, GCS, Anthropic).
```

- A router function should be readable as: *validate → call service → translate errors*.
  No SQL, no pandas, no GCS calls in a router. `uploads.py` is the one router with
  orchestration logic (`resolve_and_apply_mapping`); do not grow that pattern elsewhere.
- Services never import `fastapi`. They raise plain Python exceptions or domain exceptions
  (`RetailerNotFoundError`, `StoreHasPromotionsError`, `MappingGenerationError`, `GCSUploadError`)
  and return dicts / lists / DataFrames.
- New routers are `APIRouter(prefix="/api/<domain>", tags=["<domain>"])` and registered in
  `app/main.py` with `app.include_router(...)`.

### 2.2 Pydantic validation

- Every request body is a Pydantic model in `app/schemas/`. Inherit from `_Base`
  (`str_strip_whitespace=True`) so services never call `.strip()`.
- Use `Field(min_length=, max_length=, gt=, ge=)` constraints instead of manual checks.
  Use `Literal[...]` for closed sets. Cross-field rules go in
  `@model_validator(mode="after")` methods that `raise ValueError(...)`.
- Keep `Create` / `Update` models as thin subclasses of a shared `*Base` (see `PromotionBase`).
- Query parameters on GET endpoints are plain typed function args (`metric: str = "value"`,
  `sku: str | None = None`). Validate enumerated values inside the service with a
  module-level tuple (`SKU_RANKING_METRICS`, `DASHBOARD_MODES`) and `raise ValueError`.
- **The schema is the API contract.** Any `Literal`/enum change must be mirrored in the
  matching frontend options list (e.g. `PromoType` ↔ `PROMO_TYPES` in
  `app/utils/promotionForm.js`).

### 2.3 Dependencies and shared clients

- External clients are process-wide singletons created lazily:
  `@lru_cache(maxsize=1)` on `get_bigquery_client()`, `get_storage_client()`, `_get_engine()`;
  a guarded `global` in `generate_mapping.get_client()` and `sql.connect_with_connector()`.
  Never construct a `bigquery.Client`, `storage.Client`, `Anthropic`, or SQLAlchemy `Engine`
  inside a request path.
- Reads that are a single `SELECT` use `sql.connect_with_connector_autocommit()` via
  `_get_read_engine()`; anything that writes uses `_get_engine().begin()` so it is one
  transaction that rolls back on error.
- FastAPI `Depends()` is not currently used. If you introduce it (e.g. for a shared DB
  connection or auth), do it in one small module under `app/` and migrate a single router
  first — do not mix styles inside one router file.
- Read config from `os.environ` at call time, not module import time, unless it is a harmless
  default (`BQFairprice_TABLE`). A missing key should fail the one request that needs it
  with a clear message, not crash app startup (`get_client()` in `generate_mapping.py` is the
  model).

### 2.4 Sync vs async route handlers

- **Default to plain `def`** for handlers whose work is a blocking client call (SQLAlchemy,
  BigQuery, pandas). FastAPI runs these in a threadpool; the event loop stays free.
- Use `async def` **only** when the handler genuinely awaits (reading `UploadFile` streams,
  fanning out with `asyncio.gather`). Inside an `async def`, wrap every blocking call in
  `await asyncio.to_thread(...)` — never call `storage.upload_many` or a SQL query directly
  from an async handler. `uploads.py` is the reference.
- Never `await` inside a service function; services stay synchronous and testable.

### 2.5 Error responses

Every error the client can see is `HTTPException(status_code=..., detail=...)`. Map in the router:

| Situation | Status | `detail` |
| --- | --- | --- |
| Bad input caught in a service (`ValueError`) | 400 | `str(e)` |
| Pydantic validation failure | 422 (automatic) | FastAPI's `[{loc, msg}]` list |
| Resource missing (`None` / `False` from service) | 404 | `"<Thing> not found"` |
| Uniqueness / FK conflict (`IntegrityError`, `*HasStoresError`) | 409 | human sentence |
| Upstream unavailable (`DefaultCredentialsError`, `GoogleAPICallError`, DB down) | 503 | actionable sentence (see `_CREDENTIALS_DETAIL`) |
| Anything else | 500 | `f"Failed to <verb> <thing>: {type(e).__name__}: {e}"` |

- Order `except` clauses specific → general, and always `except HTTPException: raise` before
  the catch-all so a 404 raised inside `try` is not rewritten as a 500.
- Multi-item operations (bulk upload) return **200 with a per-item result list** and a
  `failed` count rather than failing the whole request — see the `upload_files` docstring.
- `detail` is a string, except the deliberate `{message, warnings}` dict on 422 in
  `confirm_mapping`. The frontend `parseApiError()` handles both string and list shapes.

### 2.6 SQL and data

- Raw SQL via `sqlalchemy.text()` with **named bind parameters only** (`:promotion_id`).
  Never f-string user values into SQL. F-strings are allowed only for composing trusted
  fragments (`_PROMOTION_COLUMNS`).
- BigQuery: always `QueryJobConfig(query_parameters=[ScalarQueryParameter(...)])`; build
  `where_clauses` as a list and join.
- Return `dict(row)` from `.mappings()`, `DataFrame.to_dict(orient="records")` for pandas.
  Convert datetimes to `YYYY-MM-DD` strings before returning (`_preview` is the model).
- Dates cross the API as ISO `YYYY-MM-DD` strings, validated by `DATE_PATTERN`.

### 2.7 Python style

- Python 3.11: `str | None`, `list[dict]`, no `Optional`/`List` in new code.
- Type-hint every public function signature. Docstrings on public functions state *what and
  why*, one paragraph, no Args/Returns boilerplate.
- Module-private helpers start with `_`. Constants are `UPPER_SNAKE` at module top.
- No new dependencies without adding them to `backend/requirements.txt` and a one-line
  reason in the PR.

---

## 3. Frontend (Next.js / React) rules

### 3.1 Component model

- **Function components only**, default-exported, with JSDoc `@param` typing on props for
  anything shared. No classes, no `React.FC`, no TypeScript files (`components.json` has
  `tsx: false`; jsconfig path aliases are `@/components/*` → `app/components/*`, `@/*` → `./*`).
- **Server Components by default.** Add `'use client'` only to files that use state, effects,
  event handlers, or browser APIs. Route `page.js` files that just compose a client component
  stay server components (`app/upload2/page.js` is the model).
- Every routed page is wrapped in `PageLayout` (`title`, optional `headerExtra`) — never
  hand-roll the sidebar or heading.
- Feature components live in `app/components/<feature>/`; generic primitives only in
  `app/components/ui/` and are added with `npx shadcn add <component>` from `frontend/aireos`.
  Follow `frontend/aireos/CONTRIBUTING.md` for styling (theme tokens not raw colors, `cn()`,
  `lucide-react`, no second icon library).
- Keep components under ~300 lines. When a page grows past that, move pure logic to
  `app/utils/<feature>.js` (pure functions, no React) and data fetching to `hooks/`.
  `FileUpload.jsx` (925 lines) and `PromotionList.jsx` (781 lines) are the debt, not the model.

### 3.2 Hooks and state

- **React Compiler is enabled** (`reactCompiler: true`, `babel-plugin-react-compiler`). It
  memoizes for you, so do not add `useMemo`/`useCallback` for performance. Use `useCallback`
  only when a stable identity is a *correctness* requirement (a callback passed into a hook's
  dependency list, e.g. `handleDateRangeChange` → `usePeriodComparison`).
- The compiler assumes the Rules of React. Therefore:
  - Dependency arrays are **complete and honest** — every value read inside the effect is
    listed. Never silence `react-hooks/exhaustive-deps`.
  - Collapse many filter values into one `filterKey = JSON.stringify({...})` when the effect
    should re-run on any change (`useDashboardSummary` pattern) rather than omitting deps.
  - No mutation of props/state; derive values during render instead of syncing with effects.
    "Adjust state during render" (`if (!customer && options.length) setCustomer(...)`) is
    allowed for the one-time-default case only, with a comment explaining why.
- Custom hooks live in `hooks/use<Thing>.js`, one hook per file, default export, and return a
  plain object `{ data, loading, error }` (plus `refreshing` when there is a silent-refresh
  path). Accept an options object, not positional args.
- Form state is one object (`form`, `setForm`) + one `errors` object, with pure
  `validate*`/`build*Payload`/`formFrom*` helpers in `app/utils/` — see `promotionForm.js`.

### 3.3 API fetching

- Base URL is always `process.env.NEXT_PUBLIC_API_URL` (set in `frontend/aireos/.env.local`).
  Never hard-code `localhost:8000`.
- **Preferred pattern:** one wrapper module per backend domain in `app/services/<domain>Api.js`
  exporting named async functions, one per endpoint, each with a JSDoc block naming the HTTP
  method and path. Route them through a shared `request()` that: strips the trailing slash from
  the base URL, sets `cache: 'no-store'`, parses JSON-or-text, throws an `Error` with
  `.status` and `.data`, and turns network failures into a readable message.
  `app/services/promotionsApi.js` is the reference implementation — reuse its `request` and
  `parseApiError` rather than writing a third copy.
- Hooks that fetch inline (`hooks/useDashboardSummary.js`) are acceptable for read-only
  dashboard data, but new hooks should call a `*Api.js` function instead of raw `fetch`.
- Every effect-based fetch uses the cancel flag pattern:
  ```js
  let cancelled = false;
  ...
  if (!cancelled) setState(...);
  return () => { cancelled = true; };
  ```
- Query strings are built with `URLSearchParams`; path segments use `encodeURIComponent`.
- Loading / error / empty states are always rendered. Error text comes from the thrown
  `error.message` (already server-provided via `detail`), never a generic "Something went wrong"
  when the backend said more.
- No client-side data caching layer (no SWR/React Query) unless the team agrees; keep fetching
  explicit and simple.

### 3.4 JavaScript style

- ESM, `const`/`let`, arrow functions for callbacks, named function declarations for
  components and hooks, strict equality, `async/await`, single quotes, trailing commas.
- Named exports for utilities; default export for components/hooks/pages.
- Comments explain the *why* and reference the backend function or endpoint they depend on
  (e.g. "see backend get_customer_options").
- Run `npm run lint` before committing; the config is `eslint-config-next/core-web-vitals`.

---

## 4. Testing standards

### 4.1 Backend — Pytest (mandatory)

**Setup:** `cd backend && pytest` (config in `pytest.ini`: `pythonpath = .`, `testpaths = tests`).
CI (`.github/workflows/ci.yml`) runs exactly this on every push/PR to `main`, with no cloud
credentials — so **every test must pass with no network, no `.env`, and no GCP key**.

Rules:

1. **Test services, not clients.** Target `app/services/*` functions directly. Replace the
   external client with a hand-written fake via `monkeypatch.setattr(module, "get_<client>", lambda: fake)`.
   The fakes in `tests/test_sku_ranking.py` (`FakeBigQueryClient`) and
   `tests/test_duplicate_upload.py` (`FakeStorageClient`/`FakeBlob`) are the templates —
   small classes that *record* what they were called with and return a canned result.
   No `unittest.mock.MagicMock` sprawl; a 10-line fake class is clearer.
2. **Assert on the contract, not the implementation.** For query builders, assert on the
   bound parameters (`_params_by_name(job_config)`) and on key SQL fragments, not on the
   whole SQL string. For transforms, assert on the output shape.
3. **One behaviour per test, named as a sentence:** `test_invalid_metric_raises_without_querying`,
   `test_state_drives_kind_and_confirmation`. Group with `# ---- Section ----` comment banners.
4. **Validation tests prove no side effect:** install a `_no_client_allowed` fake that raises
   `AssertionError` and assert `pytest.raises(ValueError)`.
5. **Pure modules get pure tests.** `mapping_view`, `apply_contract`, `validation_service`,
   `mapping_service` need no fakes — feed a small dict/DataFrame, assert the result.
6. **Route tests (integration)** use `fastapi.testclient.TestClient(app)` and monkeypatch the
   *service* function the router calls (`monkeypatch.setattr(promotion_service, "get_promotion", lambda _id: None)`)
   to assert the status-code mapping in §2.5. Add one per new router; don't duplicate service
   logic tests through HTTP.
7. **No real Cloud SQL/BigQuery/GCS/Anthropic calls, ever,** including "integration" tests.
   Anything that needs live infrastructure is a manual check, not a pytest.
8. Fixtures shared by more than one file go in `tests/conftest.py` (create it when needed);
   file-local helpers stay `_private` functions at the top of the test file.
9. One test file per service module: `tests/test_<module_or_feature>.py`. Keep test data
   inline and minimal (2–3 rows), typed to the real column names.
10. Every bug fix ships with the failing test that reproduces it.

### 4.2 Definition of done

- `cd backend && pytest` green, `cd frontend/aireos && npm run lint` clean.
- New endpoint → schema (if body) + service function + router + service test + status-map test
  + `*Api.js` function on the frontend with JSDoc.
- New UI behaviour → pure logic extracted to `app/utils/` where possible.
- Commit messages follow Conventional Commits as in the log: `feat:`, `fix:`, `refactor:`,
  `docs:`, `chore:`, `style:`. Branches: `feat/AO<n>-<m>-short-description`,
  `fix/...`, `refactor/...`. PRs target `main`.

---

## 5. Things never to do

- Commit `gcp-key.json`, `.env*`, or any credential. `.gitignore` already blocks `*.json`
  at the root — do not weaken it.
- Widen CORS beyond what `main.py` has without a comment; the current `allow_origin_regex=".*"`
  is dev-only and must be tightened before any deployment.
- Insert rows into BigQuery, or modify `skus`/`stores`/`retailers` rows from a promotion write.
- Add a second `components/` folder, a second icon library, a second fetch wrapper, or a
  second `.env` loader.
- Rewrite existing UI to the shadcn primitives as a standalone task (see §1.5).
