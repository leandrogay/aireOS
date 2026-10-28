from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.catalog import _Base


# ============================================================
# SCENARIO PROMOTIONS
#
# Mirrors the scenario_promotions CHECKs (007), which stay as the
# backstop. Customer and product are named the way the Forecast page
# names them, like building blocks; the service resolves them to
# customer_id / sku. The frontend builds this body in
# buildScenarioPromotionPayload (app/utils/scenarioPromotions.js).
# ============================================================


# Same values as PROMO_OVERLAY_TYPES in app/utils/forecastView.js.
ScenarioPromoType = Literal["monthly", "side_offer", "bundle", "others"]

# Same bounds as promo_uplift_settings.uplift_pct (migration 006).
_UPLIFT = {"ge": Decimal("-90"), "le": Decimal("300"), "max_digits": 6, "decimal_places": 2}


class ScenarioPromotionBase(_Base):
    customer_name: str = Field(min_length=1, max_length=255)

    # One SKU per promotion: promotions are planned per SKU.
    product_name: str = Field(min_length=1, max_length=255)

    promo_type: ScenarioPromoType
    mechanic_key: str = Field(min_length=1, max_length=40)
    mechanic_label: str = Field(min_length=1, max_length=120)

    # Copied from Promotion Uplift Settings when the promotion was set up,
    # so a later settings change does not move a saved promotion.
    reference_uplift_pct: Decimal = Field(**_UPLIFT)
    reference_source: str = Field(min_length=1, max_length=20)

    override_uplift_pct: Decimal | None = Field(default=None, **_UPLIFT)

    voucher: bool = False
    voucher_uplift_pct: Decimal = Field(default=Decimal("0"), **_UPLIFT)

    explanation: str | None = Field(default=None, max_length=2000)

    start_month: date
    end_month: date

    # Side offers only: the exact days it runs; None = whole months.
    start_date: date | None = None
    end_date: date | None = None

    is_active: bool = True

    @field_validator("explanation")
    @classmethod
    def _blank_explanation_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def validate_promotion(self):
        if self.start_month.day != 1 or self.end_month.day != 1:
            raise ValueError("start_month and end_month must be the first day of a month")

        if self.end_month < self.start_month:
            raise ValueError("end_month cannot be before start_month")

        if (self.start_date is None) != (self.end_date is None):
            raise ValueError("start_date and end_date must be given together")

        if self.start_date is not None:
            if self.promo_type != "side_offer":
                raise ValueError("Only side offers run on dates; other promotions run whole months")
            if self.end_date < self.start_date:
                raise ValueError("end_date cannot be before start_date")
            if (
                self.start_date.replace(day=1) != self.start_month
                or self.end_date.replace(day=1) != self.end_month
            ):
                raise ValueError("start_month and end_month must be the months of start_date and end_date")

        return self


class ScenarioPromotionCreate(ScenarioPromotionBase):
    pass


class ScenarioPromotionUpdate(ScenarioPromotionBase):
    pass
