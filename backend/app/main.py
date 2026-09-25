from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env.backend")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import sales, uploads, promotions, catalog, forecast

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.middleware import UnhandledErrorMiddleware

app = FastAPI()

# origins = ["http://localhost:3000"] # Frontend location

# Registered before CORSMiddleware so it ends up inside it -- see the
# docstring above for why the order matters.
app.add_middleware(UnhandledErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    # allow_origins=origins,
    allow_origin_regex=".*",   # dev only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(uploads.router)
app.include_router(sales.router)
app.include_router(catalog.router)
app.include_router(promotions.router)
app.include_router(forecast.router)


@app.get("/")
def read_root():
    return {"status": "ok"}
