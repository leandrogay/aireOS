from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app import config

from app.middleware import UnhandledErrorMiddleware
from app.routers import sales, uploads, mappings, promotions, catalog, assistant, forecast, inventory, settings

app = FastAPI()

# Registered before CORSMiddleware so it ends up inside it -- see the
# docstring above for why the order matters.
app.add_middleware(UnhandledErrorMiddleware)

# Only the listed origins (config.CORS_ALLOWED_ORIGINS) may call the API from
# a browser. Credentials are allowed, so this must stay an explicit list --
# never a wildcard or a catch-all regex.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(uploads.router)
app.include_router(mappings.router)
app.include_router(sales.router)
app.include_router(catalog.router)
app.include_router(promotions.router)
app.include_router(assistant.router)
app.include_router(forecast.router)
app.include_router(inventory.router)
app.include_router(settings.router)


@app.get("/")
def read_root():
    return {"status": "ok"}
