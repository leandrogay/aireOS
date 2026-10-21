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

# Same cap as MAX_UPLIFT_PCT on the frontend.
MAX_UPLIFT_PCT = Decimal("50")


class ScenarioBuildingBlockBase(_Base):
    customer_name: str = Field(min_length=1, max_length=255)

    # None = every SKU of the customer.
    product_name: str | None = Field(default=None, min_length=1, max_length=255)

    name: str = Field(min_length=1, max_length=120)
    explanation: str | None = Field(default=None, max_length=2000)

    uplift_mode: UpliftMode
    uplift_value: Decimal = Field(gt=0, max_digits=12, decimal_places=2)

    start_month: date
    end_month: date

    is_active: bool = True

    @field_validator("explanation")
    @classmethod
    def _blank_explanation_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def validate_block(self):
        if self.start_month.day != 1 or self.end_month.day != 1:
            raise ValueError("start_month and end_month must be the first day of a month")

        if self.end_month < self.start_month:
            raise ValueError("end_month cannot be before start_month")

        if self.uplift_mode == "pct" and self.uplift_value > MAX_UPLIFT_PCT:
            raise ValueError(f"A % uplift cannot be more than {MAX_UPLIFT_PCT}%")

        if self.uplift_mode == "units" and self.uplift_value != self.uplift_value.to_integral_value():
            raise ValueError("A units uplift must be a whole number of units")

        return self


class ScenarioBuildingBlockCreate(ScenarioBuildingBlockBase):
    pass


class ScenarioBuildingBlockUpdate(ScenarioBuildingBlockBase):
    pass
