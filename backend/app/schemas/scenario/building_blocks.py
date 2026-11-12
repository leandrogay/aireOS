from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.catalog import _Base


# ============================================================
# SCENARIO BUILDING BLOCKS
#
# Mirrors the scenario_building_blocks CHECKs, which stay as the
# backstop. Customers and product are named the way the Forecast page
# names them (customer_names / product_name from the forecast
# options); the service resolves them to customer_ids / sku.
# The frontend builds this body in buildScenarioBlockPayload
# (app/utils/scenarioBlocks.js).
# ============================================================


UpliftMode = Literal["pct", "units"]

# 'growth' is the budget's year-on-year growth (next year = this year x (1 + g)):
# a % block on every SKU of one customer from January to December, at most one
# per customer x year (migrations 016 and 024). Tier 0 has no growth of its own.
BlockKind = Literal["block", "growth"]

# Same limits as MIN_UPLIFT_PCT / MAX_UPLIFT_PCT on the frontend. A negative
# uplift is a decrease (a flood, a store closing); -100% is no sales at all.
MIN_UPLIFT_PCT = Decimal("-100")
MAX_UPLIFT_PCT = Decimal("50")


class ExcludedPair(_Base):
    """One customer x SKU range switched off on an item (migration 023); sku_range None = the customer's SKUs with no range."""

    customer_name: str = Field(min_length=1, max_length=255)
    sku_range: str | None = Field(default=None, max_length=255)


def excluded_pairs_in_order_once(pairs: list[ExcludedPair]) -> list[ExcludedPair]:
    """Repeats dropped and sorted, so one set of pairs is always stored the same way."""

    unique = {(pair.customer_name, pair.sku_range or None): pair for pair in pairs}
    return [unique[key] for key in sorted(unique, key=lambda key: (key[0], key[1] or ""))]


class ScenarioBuildingBlockBase(_Base):
    plan: Literal["scenario", "budget"] = "scenario"

    # A PUT replaces every field, so the page must send kind back unchanged.
    kind: BlockKind = "block"

    # A block can cover several customers (migration 022); None (or an empty
    # list) = every customer. A growth names exactly one.
    customer_names: list[str] | None = Field(default=None, max_length=100)

    # Blocks follow SKU ranges: sku_ranges = every SKU of those ranges; None
    # (or an empty list) with no product_name = every SKU of the customer.
    # product_name (one SKU) is only for blocks saved before ranges
    # (migration 017), so they can still be edited; never both.
    sku_ranges: list[str] | None = Field(default=None, max_length=100)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)

    # Customer x SKU ranges switched off on their own; the block stays one entry.
    excluded_pairs: list[ExcludedPair] = Field(default_factory=list, max_length=1000)

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

    @field_validator("customer_names")
    @classmethod
    def _customers_in_order_once(cls, value: list[str] | None) -> list[str] | None:
        # Same rule as sku_ranges: one set of customers is stored one way;
        # nothing left = every customer (None).
        names = sorted({item.strip() for item in value or [] if item and item.strip()})
        if any(len(item) > 255 for item in names):
            raise ValueError("A customer name is at most 255 characters")
        return names or None

    @field_validator("excluded_pairs")
    @classmethod
    def _pairs_in_order_once(cls, value: list[ExcludedPair]) -> list[ExcludedPair]:
        return excluded_pairs_in_order_once(value)

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

        if self.plan == "budget" and self.start_month.year != self.end_month.year:
            raise ValueError("Budget entries must stay within one calendar year")

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

        if self.customer_names is None or len(self.customer_names) != 1:
            raise ValueError("Growth is set for one customer")

        if self.excluded_pairs:
            raise ValueError("Growth covers its one customer and range; nothing can be switched off")

        if self.sku_ranges is not None or self.product_name is not None:
            raise ValueError("Growth covers every SKU of the customer")

        if self.start_month.month != 1 or self.end_month != date(self.start_month.year, 12, 1):
            raise ValueError("Growth covers one whole year, January to December")


class ScenarioBuildingBlockCreate(ScenarioBuildingBlockBase):
    pass


class ScenarioBuildingBlockUpdate(ScenarioBuildingBlockBase):
    pass
