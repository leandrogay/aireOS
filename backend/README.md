# Backend

## Setup

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

On macOS/Linux, use `python3 -m venv venv` and `source venv/bin/activate`.

### Environment variables

Copy `.env.example` to `.env.backend` in `backend/` and fill in the values, then place your GCP service account credentials at `backend/gcp-key.json`.

```bash
cd backend
cp .env.example .env.backend
```

All settings are read once by `app/config.py`, which is the only module that
touches `os.environ` or loads the env file. Add new settings there rather than
calling `os.environ.get` from a service.

Path-valued settings (`SERVICE_ACCOUNT_KEY_PATH`, `GOOGLE_APPLICATION_CREDENTIALS`)
are resolved relative to `backend/`, so `./gcp-key.json` works no matter which
directory you launch the app from.

The key file is optional. With both key paths unset, every Google client
(Cloud SQL, GCS, BigQuery, Vertex AI) uses Application Default Credentials:
the service's own service account on Cloud Run, or your own login locally
after `gcloud auth application-default login`. A key path that is set but
points at a missing file is still an error.

## Serving the backend

```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

Runs at [http://localhost:8000](http://localhost:8000).

## Clean sell-out data in Cloud SQL

Recognised uploads are mapped and validated before database writes. The
loader uses the shared connection in `app/services/sql.py` and the catalog's
retailer/store helpers. Existing store names and populated formats are
preserved; a missing format can be filled. Unseen SKUs are inserted, but
existing SKU master fields are never overwritten by an upload.

Database writes are disabled by default. Before enabling them:

1. Review `migrations/001_create_sellout.sql` with the database owner.
2. Run the migration once against the PostgreSQL Cloud SQL database.
3. Set `CLOUD_SQL_LOAD_ENABLED=true` in `.env.backend` and restart the backend.

Normal uploads upsert the business key `(retailer_id, store_code, sku,
period_start, period_type)`. Forced filename replacement deletes the previous
facts for that `source_file` and inserts the new valid facts in one transaction.

Apply `migrations/006_create_ingestion_rollback.sql` before enabling upload
rollback. Each new transformed upload then records one `ingestion_runs` audit
row and append-only `sellout_versions` rows in the same transaction as the
`sellout` write. Staff can roll back a completed upload from Recent uploads;
the service restores any prior values atomically while retaining the raw GCS
file and mapping contract for traceability. Uploads completed before this
migration are not retroactively reversible.

The current fact schema does not retain sales UOM. FairPrice labels the source
measure `Qty (in EA)`, while the established downstream forecasting contract
currently treats the values as cartons. The pipeline performs no numeric unit
conversion. Source rows sharing a business key have their quantities and
revenue summed without another pack-size conversion. Any future unit-contract
change requires coordinated schema and consumer updates.

## SKU catalog management

`/api/catalog/skus` provides the active SKU catalog used by the `/skus`
screen. Staff can create, search, filter and update complete master records;
the SKU code is immutable and remains globally unique. Each create/update is
snapshotted in `sku_history`. Historical price calculations can call
`get_product_prices(as_of_date=...)` to use the version recorded by the end of
that date instead of applying today's catalog price to an earlier period.

Apply `migrations/003_create_sku_management.sql` and then
`migrations/004_consolidate_sku_versions.sql` before using this screen. A
delete request is intentionally an archive: it is refused while the SKU is
attached to a promotion, records an `archived` version in `sku_history`, and
marks the `skus` row inactive. Keeping that stable master row preserves
foreign-key references from historical sell-out and inventory facts while
removing it from active catalog and promotion options. The consolidation
migration moves any legacy archive snapshots into `sku_history` before
removing the redundant archive table.

## Clean sell-out data in BigQuery

The API writes facts to Cloud SQL, not directly to BigQuery. Datastream
replicates the normalized sales, inventory, promotion, and catalog tables into
`aire-data.Aire_Data_Analytics`.

```text
Stream: aireos-to-analytics
Region: us-central1
Publication: aireos_sellout_pub
Replication slot: aireos_analytics_slot
Source objects: 12 public-schema tables
Destination: aire-data.Aire_Data_Analytics
Write mode: Merge
Maximum staleness: 15 minutes
```

The replicated objects are `sellout`, `customers`, `customer_retailers`,
`doh_settings`, `inventory_metric_types`, `inventory_metrics`,
`promotions`, `promotion_skus`, `promotion_stores`, `retailers`, `stores`, and
`skus`. Datastream backfills existing facts and replicates subsequent inserts,
updates, and deletes. See the repository's
[pipeline implementation notes](../docs/data-pipeline-implementation-notes.md)
for verified counts and the remaining analytics work.

The sales dashboard (`/api/sales/*`, `app/services/sellout_service.py`) reads
the Cloud SQL `sellout` table directly -- the operational source of truth
every upload writes to first, not a BigQuery replica. Its rows carry only
`retailer_id`, `store_code` and `sku`; plain SQL joins to `retailers`/
`stores`/`skus` resolve them to names. A retailer+calendar-month with
monthly-granularity rows uses only those (never combined with that month's
weekly rows) -- see `EFFECTIVE_SELLOUT_CTE` in `sellout_service.py`.

## Running tests

```powershell
cd backend
.\venv\Scripts\python.exe -m pytest -q
```

Test configuration lives in `pytest.ini`; tests live in `tests/` and mock cloud
services rather than uploading data to live infrastructure.

## Backend structure

```text
backend/
├── app/
│   ├── routers/       # API route definitions
│   ├── schemas/        # Pydantic request/response models
│   ├── services/       # Business logic
│   ├── config.py        # Central settings; the only reader of .env.backend
│   └── main.py          # FastAPI app entrypoint
├── migrations/           # Reviewed database setup scripts
├── tests/                # Test suite
├── venv/                 # Virtual environment (not committed)
├── .env.example          # Template for .env.backend (committed)
├── .env.backend          # Local environment variables (not committed)
├── gcp-key.json           # GCP service account key (not committed)
├── pytest.ini
├── requirements.txt
└── README.md
```

> `.env.backend` and `gcp-key.json` contain secrets — make sure they're in `.gitignore` and never committed.
