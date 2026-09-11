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

Create a `.env.local` file in `backend/` with the required environment variables, and place your GCP service account credentials at `backend/gcp-key.json`.

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
│   └── main.py          # FastAPI app entrypoint
├── tests/                # Test suite
├── venv/                 # Virtual environment (not committed)
├── .env.local            # Local environment variables (not committed)
├── gcp-key.json           # GCP service account key (not committed)
├── pytest.ini
├── requirements.txt
└── README.md
```

> `.env.local` and `gcp-key.json` contain secrets — make sure they're in `.gitignore` and never committed.
