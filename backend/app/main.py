from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app import config  # noqa: F401

from app.middleware import UnhandledErrorMiddleware
from app.auth import require_user
from app.routers import auth, sales, uploads, mappings, promotions, catalog, assistant, forecast, inventory, settings

app = FastAPI()

# origins = ["http://localhost:3000"] # Frontend location

# Registered before CORSMiddleware so it ends up inside it -- see the
# docstring above for why the order matters.
app.add_middleware(UnhandledErrorMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.AUTH_FRONTEND_URL.rstrip("/")] if config.auth_enabled() else [],
    allow_origin_regex=None if config.auth_enabled() else ".*",  # dev only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

protected = [Depends(require_user)]

app.include_router(auth.router)
app.include_router(uploads.router, dependencies=protected)
app.include_router(mappings.router, dependencies=protected)
app.include_router(sales.router, dependencies=protected)
app.include_router(catalog.router, dependencies=protected)
app.include_router(promotions.router, dependencies=protected)
app.include_router(assistant.router, dependencies=protected)
app.include_router(forecast.router, dependencies=protected)
app.include_router(inventory.router, dependencies=protected)
app.include_router(settings.router, dependencies=protected)


@app.get("/")
def read_root():
    return {"status": "ok"}
