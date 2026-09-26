from fastapi import APIRouter

from app.routers.settings import doh


# Customer-level settings are under /api/settings, one sub-router per kind
# of setting (/api/settings/doh today). A new kind gets its own module in
# this package and one include_router line here; main.py does not change.
router = APIRouter(prefix="/api/settings")

router.include_router(doh.router)
