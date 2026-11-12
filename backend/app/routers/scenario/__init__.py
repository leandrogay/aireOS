from fastapi import APIRouter

from app.routers.scenario import budgets, building_blocks, promotions, tier0_breakdown


# Scenario builder items are under /api/scenario, one sub-router per kind
# of item (/api/scenario/building-blocks today; draft promotions get
# /api/scenario/promotions). A new kind gets its own module in this package
# and one include_router line here; main.py does not change.
router = APIRouter(prefix="/api/scenario")

router.include_router(building_blocks.router)
router.include_router(promotions.router)
router.include_router(tier0_breakdown.router)
router.include_router(budgets.router)
