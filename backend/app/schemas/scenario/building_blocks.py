from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.catalog import _Base


# ============================================================
# SCENARIO BUILDING BLOCKS
#
# Mirrors the scenario_building_blocks CHECKs, which stay as the
# backstop. Customer and product are named the way the Forecast page
# names them (customer_name / product_name from the forecast
# options); the service resolves them to customer_id / sku.
# The frontend builds this body in buildScenarioBlockPayload
# (app/utils/scenarioBlocks.js).
# ============================================================


UpliftMode = Literal["pct", "units"]

# 'growth' is the budget's year-on-year growth (next year = this year x (1 + g)):
# a % block on one SKU range from January to December, at most one per customer
# x range x year (migrations 016 and 017). Tier 0 has no growth of its own.
BlockKind = Literal["block", "growth"]

# Same limits as MIN_UPLIFT_PCT / MAX_UPLIFT_PCT on the frontend. A negative
# uplift is a decrease (a flood, a store closing); -100% is no sales at all.
MIN_UPLIFT_PCT = Decimal("-100")
MAX_UPLIFT_PCT = Decimal("50")


class ScenarioBuildingBlockBase(_Base):
    # A PUT replaces every field, so the page must send kind back unchanged.
    kind: BlockKind = "block"

    customer_name: str = Field(min_length=1, max_length=255)

    # Blocks follow SKU ranges: sku_ranges = every SKU of those ranges; None
    # (or an empty list) with no product_name = every SKU of the customer.
    # product_name (one SKU) is only for blocks saved before ranges
    # (migration 017), so they can still be edited; never both.
    sku_ranges: list[str] | None = Field(default=None, max_length=100)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)

    name: str = Field(min_length=1, max_length=120)
    explanation: str | None = Field(default=None, max_length=2000)

    uplift_mode: UpliftMode
    # Signed: negative lowers sales. Never 0 (validate_block).
    uplift_value: Decimal = Field(max_digits=12, decimal_places=2)

    start_month: date
    end_month: date

    is_active: bool = True

    @field_validator("explanation")
    @classmethod
    def _blank_explanation_is_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("sku_ranges")
    @classmethod
    def _ranges_in_order_once(cls, value: list[str] | None) -> list[str] | None:
        # Stripped, blanks and repeats dropped, sorted, so one set of ranges
        # is always stored the same way; nothing left = all ranges (None).
        ranges = sorted({item.strip() for item in value or [] if item and item.strip()})
        if any(len(item) > 255 for item in ranges):
            raise ValueError("A SKU range name is at most 255 characters")
        return ranges or None

    @model_validator(mode="after")
    def validate_block(self):
        if self.start_month.day != 1 or self.end_month.day != 1:
            raise ValueError("start_month and end_month must be the first day of a month")

        if self.end_month < self.start_month:
            raise ValueError("end_month cannot be before start_month")

        if self.sku_ranges is not None and self.product_name is not None:
            raise ValueError("A block covers SKU ranges or one SKU, not both")

        if self.uplift_value == 0:
            raise ValueError("An uplift cannot be 0")

        if self.uplift_mode == "pct" and not MIN_UPLIFT_PCT <= self.uplift_value <= MAX_UPLIFT_PCT:
            raise ValueError(f"A % uplift must be between {MIN_UPLIFT_PCT}% and +{MAX_UPLIFT_PCT}%")

        if self.uplift_mode == "units" and self.uplift_value != self.uplift_value.to_integral_value():
            raise ValueError("A units uplift must be a whole number of units")

        if self.kind == "growth":
            self._validate_growth()

        return self

    def _validate_growth(self) -> None:
        if self.uplift_mode != "pct":
            raise ValueError("Growth must be a % uplift")

        if self.sku_ranges is None or len(self.sku_ranges) != 1 or self.product_name is not None:
            raise ValueError("Growth is set for one SKU range")

        if self.start_month.month != 1 or self.end_month != date(self.start_month.year, 12, 1):
            raise ValueError("Growth covers one whole year, January to December")


class ScenarioBuildingBlockCreate(ScenarioBuildingBlockBase):
    pass


class ScenarioBuildingBlockUpdate(ScenarioBuildingBlockBase):
    pass
