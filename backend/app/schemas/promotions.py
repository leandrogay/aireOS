from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


PromoType = Literal[
    "regular",
    "side_offer",
    "carton",
    "bundle",
]


class _Base(BaseModel):
    # Strips leading/trailing whitespace on every str field,
    # including the items inside `skus`. This is why the
    # service layer no longer calls .strip() everywhere.
    model_config = ConfigDict(str_strip_whitespace=True)


class RetailerCreate(_Base):
    retailer_name: str = Field(
        min_length=1,
        max_length=255,
    )


class RetailerUpdate(_Base):
    retailer_name: str = Field(
        min_length=1,
        max_length=255,
    )


class StoreBase(_Base):
    retailer_id: int = Field(gt=0)

    store_code: str = Field(
        min_length=1,
        max_length=100,
    )

    store_name: str = Field(
        min_length=1,
        max_length=255,
    )


class StoreCreate(StoreBase):
    pass


class StoreUpdate(StoreBase):
    pass


class PromotionBase(_Base):
    retailer: str = Field(
        min_length=1,
        max_length=255,
    )

    store_name: str = Field(
        min_length=1,
        max_length=255,
    )

    store_code: str = Field(
        min_length=1,
        max_length=100,
    )

    period_start: date
    period_end: date

    period_label: str | None = Field(
        default=None,
        max_length=100,
    )

    promo_type: PromoType

    promotion_mechanic: str | None = None

    voucher: str | None = Field(
        default=None,
        max_length=255,
    )

    skus: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_period(self):
        if self.period_end < self.period_start:
            raise ValueError(
                "period_end cannot be earlier than period_start"
            )

        return self


class PromotionCreate(PromotionBase):
    pass


class PromotionUpdate(PromotionBase):
    pass