from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.routers import sales, uploads

app = FastAPI()

# origins = ["http://localhost:3000"] # Frontend location

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


@app.get("/")
def read_root():
    return {"status": "ok"}
