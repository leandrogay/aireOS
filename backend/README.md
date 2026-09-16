# Backend

## Setup

```bash
cd backend

# Windows
python -m venv venv

# macOS / Linux
python3 -m venv venv
```

Activate the virtual environment:

```bash
# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

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

**Terminal 1 — Backend:**

```bash
cd backend
venv\Scripts\activate   # or: source venv/bin/activate
uvicorn app.main:app --reload
```

Runs at [http://localhost:8000](http://localhost:8000)

## Running tests

```bash
cd backend
venv\Scripts\activate   # or: source venv/bin/activate
pytest
```

Test configuration lives in `pytest.ini`; tests live in `tests/`.

## Backend structure

```
backend/
├── app/
│   ├── routers/       # API route definitions
│   ├── schemas/        # Pydantic request/response models
│   ├── services/       # Business logic
│   ├── config.py        # Central settings; the only reader of .env.backend
│   └── main.py          # FastAPI app entrypoint
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
