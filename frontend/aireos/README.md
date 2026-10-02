# Frontend

## Setup

```bash
cd frontend
npm install
```

### Environment variables

Download `.env.frontend` from Google Drive and place it in `frontend/aireos/` (not committed — see `.gitignore`). It is required: `next.config.mjs` loads it on startup and `npm run dev` fails if it is missing.

## Serving the frontend

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev
```

Runs at [http://localhost:3000](http://localhost:3000)

## Frontend structure

```
frontend/
├── app/
│   ├── components/
│   │   ├── dashboard/
│   │   ├── layout/
│   │   ├── promotions/
│   │   ├── ui/
│   │   └── upload/
│   ├── dashboard/
│   ├── forecast/
│   ├── inventory/
│   ├── promotions/
│   ├── services/
│   ├── upload/
│   ├── utils/
│   ├── favicon.ico
│   ├── globals.css
│   ├── layout.js         # Root layout
│   └── page.js            # Home page
├── hooks/                  # Custom React hooks
├── lib/                     # Shared utilities/config
├── public/                  # Static assets
├── .env.frontend           # Local environment variables (not committed)
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── components.json
├── CONTRIBUTING.md
├── eslint.config.mjs
├── jsconfig.json
├── next.config.mjs
├── package.json
├── package-lock.json
└── README.md
```
