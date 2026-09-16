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

Copy `.env.example` to `.env.backend` and fill in the local values. Set the
credential paths to your GCP service account key. Never commit `.env.backend`
or credential files. Environment variables already set by the process take
precedence over the local file.

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

The current fact schema does not retain sales UOM. Quantities are already
measured in EA; CAR and EA rows sharing a business key have their quantities
and revenue summed without another pack-size conversion. Separating them
requires a future coordinated schema and primary-key migration.

## Clean sell-out data in BigQuery

The API writes facts to Cloud SQL, not directly to BigQuery. Datastream
replicates `public.sellout` into `aire-data.Aire_Data.public_sellout`.

```text
Stream: aireos-sellout-to-bigquery
Region: us-central1
Publication: aireos_sellout_pub
Replication slot: aireos_sellout_slot
Source object: public.sellout
Destination: aire-data.Aire_Data
Write mode: Merge
Maximum staleness: 15 minutes
```

Datastream backfills existing facts and replicates subsequent inserts,
updates, and deletes. The sales dashboard still queries its legacy table;
switching it to the replicated facts is a separate integration step.

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
|-- app/
|   |-- config.py          # Shared local environment loading
|   |-- routers/           # API routes
|   |-- schemas/           # Request models and ingestion fields
|   `-- main.py            # FastAPI entrypoint
|-- migrations/           # Reviewed database setup scripts
|-- tests/
|-- venv/                 # Local virtual environment (not committed)
|-- .env.backend          # Local secrets (not committed)
|-- .env.example          # Safe configuration template
|-- gcp-key.json          # Service account key (not committed)
|-- pytest.ini
|-- requirements.txt
`-- README.md
```
