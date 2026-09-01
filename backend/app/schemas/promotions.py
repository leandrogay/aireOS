from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


PromoType = Literal[
    "regular",
    "side_offer",
    "carton",
    "bundle",
]


class PromotionBase(BaseModel):
    retailer: str = Field(
        min_length=1,
        max_length=255,
    )

    store_name: str = Field(
        min_length=1,
        max_length=255,
    )

    store_code: int

    week_start: date
    week_end: date

    period_label: str | None = None
    promo_type: PromoType

    promotion_mechanic: str | None = None
    voucher: str | None = None

    skus: list[str] = Field(
        default_factory=list
    )

    @model_validator(mode="after")
    def validate_dates(self):
        if self.week_end < self.week_start:
            raise ValueError(
                "week_end cannot be earlier than week_start"
            )

        return self


class PromotionCreate(PromotionBase):
    pass


class PromotionUpdate(PromotionBase):
    pass


class RetailerCreate(BaseModel):
    retailer_name: str = Field(
        min_length=1,
        max_length=255,
    )


class RetailerUpdate(BaseModel):
    retailer_name: str = Field(
        min_length=1,
        max_length=255,
    )


class StoreCreate(BaseModel):
    retailer_id: int
    store_code: int

    store_name: str = Field(
        min_length=1,
        max_length=255,
    )


class StoreUpdate(BaseModel):
    retailer_id: int
    store_code: int

    store_name: str = Field(
        min_length=1,
        max_length=255,
    )