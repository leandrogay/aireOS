### Backend setup

```bash
cd backend
python -m venv venv
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

### Serving the Backend

**Terminal 1 — Backend:**

```bash
cd backend
venv\Scripts\activate   # or: source venv/bin/activate
uvicorn app.main:app --reload
```

Runs at [http://localhost:8000](http://localhost:8000)

## Backend Structure
```bash
backend/
    ├── app/
    │   ├── routers/
    │   ├── services/
    │   └── main.py
    ├── venv/
    └── README.md
```