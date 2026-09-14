# Frontend

## Setup

```bash
cd frontend
npm install
```

### Environment variables

Create a `.env.local` file in `frontend/` with the required environment variables (not committed — see `.gitignore`).

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
├── .env.local              # Local environment variables (not committed)
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
