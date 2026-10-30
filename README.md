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
- **Node.js 18+ and npm** — [nodejs.org](https://nodejs.org/)
- **Git**

Check your versions:

```bash
python --version
node --version
npm --version
git --version
```

## First-Time Setup

Clone the repo, then set up each side separately.
Frontend and Backend specific instructions are located in the respective folder READMEs.

### Environment variables
Download the `.env.frontend` file from Google Drive and place it in `frontend\aireos\`.

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
runs through the deterministic transformation in either stored contract format
(`backend/app/services/sellout_ingestion.py` → `apply_contract.py`). A matching
file is standardised, validated and loaded into Cloud SQL. Unrecognised layouts continue to the Gemini
proposal and review workflow. Mapping does not insert rows into BigQuery.

## Coding Standards

The recent changes follow the team conventions in the shared coding standards document.

- JavaScript uses `const` and `let`, arrow functions, strict equality, and async/await.
- Shared logic is split into small helper functions and uses named exports where appropriate.
- Python service code keeps behavior in focused modules with explicit helper functions and targeted tests.
- No existing sales or upload tables are modified; mapping data is written to JSON packets in the bucket, never to BigQuery.
