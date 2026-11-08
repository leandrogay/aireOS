# aireOS
Team WIP x Aire - FYP

## Project documentation

- [Sales, inventory, promotions, and BigQuery pipeline](docs/data-pipeline-implementation-notes.md)

## Tech Stack

- **Frontend:** Next.js, JavaScript, React, Tailwind CSS
- **Backend:** Python, FastAPI, pandas, openpyxl

## Prerequisites

Install these before doing anything else:

- **Python 3.15** — [python.org/downloads](https://www.python.org/downloads/)
- **Node.js 20.12+ (22 LTS recommended) and npm** — [nodejs.org](https://nodejs.org/).
  Next.js 16 and `next.config.mjs` (`process.loadEnvFile`) do not run on older versions.
- **Git**
- **Google Cloud CLI (`gcloud`)** — only if you sign in with your own Google account instead of
  a `gcp-key.json`, or to deploy

Check your versions:

```bash
python --version
node --version
npm --version
git --version
```

## Setting up the servers (local development)

aireOS runs as two servers side by side: the **backend** (FastAPI, port 8000) and the
**frontend** (Next.js, port 3000). Both need their own env file. PowerShell is shown; macOS/Linux
differences are noted.

### 1. Clone the repo

```powershell
git clone <repo-url> aireOS
cd aireOS
```

### 2. Backend: install

```powershell
cd backend
py -3.15 -m venv venv
.\venv\Scripts\Activate.ps1      # macOS/Linux: python3.15 -m venv venv; source venv/bin/activate
pip install -r requirements.txt
```

If PowerShell refuses to run `Activate.ps1`, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and try again.

### 3. Backend: configure

```powershell
copy .env.example .env.backend   # macOS/Linux: cp .env.example .env.backend
```

Fill in `backend/.env.backend` (ask the team for the values): `GCP_PROJECT_ID`, `GCS_BUCKET_NAME`,
`POSTGRESQL_INSTANCE_CONNECTION_NAME`, `DB_IAM_USER` and `DB_NAME`. Everything else has a working
default for local use; leave `AUTH_ENABLED=false` until you need SSO (see below).

Then give the backend Google credentials, in **one** of two ways:

- **Service-account key:** place the key file at `backend/gcp-key.json` (the default paths in
  `.env.example` already point there). Never commit it.
- **Your own Google login:** blank out `GOOGLE_APPLICATION_CREDENTIALS` and
  `SERVICE_ACCOUNT_KEY_PATH` in `.env.backend`, then run
  `gcloud auth application-default login`. Your account needs access to the project's
  Cloud SQL, GCS, BigQuery and Vertex AI.

### 4. Frontend: install and configure

```powershell
cd ..\frontend\aireos
npm install
```

Download `.env.frontend` from the team Google Drive into `frontend/aireos/`. It must contain at least
`NEXT_PUBLIC_API_URL=http://localhost:8000`. `npm run dev` fails with `ENOENT ... .env.frontend`
if the file is missing.

### 5. Start both servers

Use two terminals, both from the repo root.

**Terminal 1 — backend:**

```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

**Terminal 2 — frontend:**

```powershell
cd frontend\aireos
npm run dev
```

### 6. Check it works

- [http://localhost:8000](http://localhost:8000) returns `{"status": "ok"}`, and
  [http://localhost:8000/docs](http://localhost:8000/docs) lists the API.
- [http://localhost:8000/api/promotions/health/db](http://localhost:8000/api/promotions/health/db)
  confirms Cloud SQL is reachable.
- [http://localhost:3000](http://localhost:3000) opens the dashboard.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ENOENT ... .env.frontend` | `.env.frontend` is missing from `frontend/aireos/` (step 4) |
| API calls return 503 mentioning credentials | `gcp-key.json` missing, or run `gcloud auth application-default login` (step 3) |
| Browser shows a CORS error | Open the app at `localhost:3000` or `127.0.0.1:3000`, or add your origin to `CORS_ALLOWED_ORIGINS` |
| `Address already in use` | Another server is on that port; stop it, or run `uvicorn app.main:app --reload --port 8001` and point `NEXT_PUBLIC_API_URL` at it |
| `uvicorn` not found | The venv is not activated (`.\venv\Scripts\Activate.ps1`) |

### Running the tests

```powershell
cd backend; .\venv\Scripts\python.exe -m pytest -q    # no cloud credentials needed
cd frontend\aireos; npm test; npm run lint
```

More detail on each side is in [backend/README.md](backend/README.md) and
[frontend/aireos/README.md](frontend/aireos/README.md).

### Google Workspace SSO

Authentication is disabled by default so tests and local development do not require live OAuth credentials.
To enable it, create a Google OAuth 2.0 **Web application** client and add
`http://localhost:8000/api/auth/callback` as an authorised redirect URI. Then configure:

- Backend `.env.backend`: `AUTH_ENABLED=true`, a random `AUTH_SESSION_SECRET` of at least 32 characters,
  `AUTH_ALLOWED_DOMAIN=shop-aire.com`, `AUTH_FRONTEND_URL`, `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI`.
- Frontend `.env.frontend`: `NEXT_PUBLIC_AUTH_ENABLED=true`.

Keep `AUTH_COOKIE_SECURE=false` and `AUTH_COOKIE_DOMAIN` blank on localhost. In production, use HTTPS,
set `AUTH_COOKIE_SECURE=true`, and set `AUTH_COOKIE_DOMAIN` to a shared parent domain such as
`.shop-aire.com` when the frontend and backend use separate subdomains.

## Deploying (Cloud Run)

Local development does not use any of this: it keeps `.env.backend` and `.env.frontend`.
Each deployed environment has a folder under `deploy/` (`test` today; `prod` will be a copy):

| File | Holds | Secret? |
| --- | --- | --- |
| `deploy/<env>/target.env` | Project, region, registry, service names and service accounts | No |
| `deploy/<env>/api.env.yaml` | API runtime settings (replaces **all** env vars on each deploy) | No |
| `deploy/<env>/api.secrets.yaml` | Secret **names** only (`AUTH_SESSION_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`); values live in Secret Manager | Names only |
| `deploy/<env>/web.build.env` | Frontend build args, compiled into the bundle and visible to visitors | No |

Never put a secret in the env or build files; `backend/tests/test_deploy_config.py` fails CI if a
setting named like one appears there. Change settings in these files, not in the Cloud Run console --
the next deploy overwrites console edits.

The web service forwards `/api/*` to the API (`BACKEND_API_URL`), so the browser, the session cookie
and the Google sign-in callback all use the web service's URL.

First time for an environment (PowerShell shown; `deploy.sh` / `setup-secrets.sh` are the bash versions):

```powershell
gcloud auth login
./deploy/setup-secrets.ps1 -Env test   # creates the secrets; asks for the OAuth client secret
./deploy/deploy.ps1 -Env test          # builds both images at HEAD, pushes, deploys
```

The Google OAuth client needs `GOOGLE_OAUTH_REDIRECT_URI` from `api.env.yaml` as an authorised redirect URI.
After that, `deploy.ps1 -Env test` is the whole deploy; commit first, since the image tag is the commit hash.
To rotate a secret: `./deploy/setup-secrets.ps1 -Env test -Name GOOGLE_OAUTH_CLIENT_SECRET`, then deploy.
To roll back: `gcloud run services update-traffic <service> --region asia-southeast1 --to-revisions <revision>=100`.

## Mapping Workflow

The upload flow reads and edits mappings through the backend instead of using local fixture data.

A mapping is a contract: a set of instructions, not a copy of a file. It has one
entry per target field, saying how it is filled -- from a column, computed, a
constant, or not available in this file (with the reason) -- plus where the data
sits in the file, whether rows roll up to months, and a table of the retailer's
product codes and the master SKU each one is. Mapping generation writes and checks
it; the transformation reads it and does exactly what it says. See
[backend/app/services/mapping_contract.py](backend/app/services/mapping_contract.py).

- Before anything is mapped, [layout_detection.py](backend/app/services/layout_detection.py) finds the data table: the right sheet (never a pivot), the header row, preamble, footer totals, merged cells.
- A file whose layout was confirmed before -- including next month's file of it -- is matched by a fingerprint of its header templates and runs without calling the model.
- Mappings for new layouts are proposed by Gemini on Vertex AI in [generate_mapping.py](backend/app/services/generate_mapping.py), checked statically against the file and the SKU master ([mapping_checks.py](backend/app/services/mapping_checks.py)), and stored as JSON in the bucket under `mappings/pending/` and `mappings/confirmed/` (earlier approved versions under `mappings/history/`).
- A product code in the file that is not a master SKU fails the checks: the mapping cannot be approved until its code table names the master SKU (editable on the review screen) or the product is added to the SKU master.
- Reference contracts for FairPrice, NHG and Sheng Siong live in [reference_contracts.py](backend/app/services/reference_contracts.py); `python scripts/install_reference_contracts.py --write` stores them as confirmed mappings, and `python scripts/eval_mapping.py` scores the model's proposals against them.
- Contracts are normalised into the review shape by [backend/app/services/mapping_view.py](backend/app/services/mapping_view.py).
- The UI reads and confirms mappings from [frontend/aireos/app/mappings/page.js](frontend/aireos/app/mappings/page.js) and [frontend/aireos/app/components/mappings/MappingReviewPanel.jsx](frontend/aireos/app/components/mappings/MappingReviewPanel.jsx).

| Endpoint | Purpose |
| --- | --- |
| `POST /api/uploads` | Upload files, apply a recognised mapping immediately, or propose a mapping for an unrecognised layout |
| `GET /api/uploads/mappings` | Every mapping the review screen shows, in one shape |
| `GET /api/uploads/mappings/{fingerprint}` | One contract, confirmed if it exists, else pending |
| `POST /api/uploads/mappings/{fingerprint}/confirm` | Approve a proposal, or amend a confirmed mapping |
| `DELETE /api/uploads/mappings/{fingerprint}/pending` | Discard a rejected proposal |

`POST /api/uploads` is the single ingestion entry point. A recognised layout
runs through the deterministic transformation
(`backend/app/services/sellout_ingestion.py` → `apply_contract.py`). A matching
file is standardised, validated and loaded into Cloud SQL. Unrecognised layouts continue to the Gemini
proposal and review workflow. Mapping does not insert rows into BigQuery.

## Coding Standards

The recent changes follow the team conventions in the shared coding standards document.

- JavaScript uses `const` and `let`, arrow functions, strict equality, and async/await.
- Shared logic is split into small helper functions and uses named exports where appropriate.
- Python service code keeps behavior in focused modules with explicit helper functions and targeted tests.
- No existing sales or upload tables are modified; mapping data is written to JSON packets in the bucket, never to BigQuery.
