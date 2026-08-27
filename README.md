# aireOS
Team WIP x Aire - FYP

## Tech Stack

- **Frontend:** Next.js, JavaScript, React, Tailwind CSS
- **Backend:** Python, FastAPI, pandas, openpyxl

## Prerequisites

Install these before doing anything else:

- **Python 3.11+** — [python.org/downloads](https://www.python.org/downloads/)
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
Download the `.env.local file` from the Google Drive and place it in frontend\aireos\

## Mapping Workflow

The upload flow now reads and edits mappings through the backend instead of using local fixture data.

- Existing mappings are resolved in [backend/app/services/mapping_service.py](backend/app/services/mapping_service.py).
- Mapping amendments are stored in a separate BigQuery table through [backend/app/services/mapping_store.py](backend/app/services/mapping_store.py).
- The UI reads and saves mappings from [frontend/aireos/app/upload/page.js](frontend/aireos/app/upload/page.js) and [frontend/aireos/app/components/upload/MappingReview.jsx](frontend/aireos/app/components/upload/MappingReview.jsx).

## Coding Standards

The recent changes follow the team conventions in the shared coding standards document.

- JavaScript uses `const` and `let`, arrow functions, strict equality, and async/await.
- Shared logic is split into small helper functions and uses named exports where appropriate.
- Python service code keeps behavior in focused modules with explicit helper functions and targeted tests.
- No existing sales or upload tables are modified; mapping data is written to a separate BigQuery table.