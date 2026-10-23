from fastapi import APIRouter

from app.routers.scenario import building_blocks, promotions


# Scenario builder items are under /api/scenario, one sub-router per kind
# of item (/api/scenario/building-blocks today; draft promotions get
# /api/scenario/promotions). A new kind gets its own module in this package
# and one include_router line here; main.py does not change.
router = APIRouter(prefix="/api/scenario")

router.include_router(building_blocks.router)
router.include_router(promotions.router)
