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

The current fact schema does not retain sales UOM. FairPrice labels the source
measure `Qty (in EA)`, while the established downstream forecasting contract
currently treats the values as cartons. The pipeline performs no numeric unit
conversion. Source rows sharing a business key have their quantities and
revenue summed without another pack-size conversion. Any future unit-contract
change requires coordinated schema and consumer updates.

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
`customer_doh_targets`, `inventory_metric_types`, `inventory_metrics`,
`promotions`, `promotion_skus`, `promotion_stores`, `retailers`, `stores`, and
`skus`. Datastream backfills existing facts and replicates subsequent inserts,
updates, and deletes. See the repository's
[pipeline implementation notes](../docs/data-pipeline-implementation-notes.md)
for verified counts and the remaining analytics work.

The sales dashboard (`/api/sales/*`, `app/services/bigquery.py`) reads
`aire-data.Aire_Data_Analytics.public_sellout`, set by `BQ_SELLOUT_TABLE` in
`app/config.py`. Its rows carry only `retailer_id`, `store_code` and `sku`;
`app/services/sellout_lookup.py` resolves them to names from the Cloud SQL
catalog.

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
