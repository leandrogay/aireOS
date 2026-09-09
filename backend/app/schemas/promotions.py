from datetime import date
from typing import Literal

from pydantic import Field, model_validator

# A promotion is written against the catalog: its SKU lines
# reuse the catalog SkuItem shape, and _Base carries the
# shared str-stripping config.
from app.schemas.catalog import SkuItem, _Base


PromoType = Literal[
    "regular",
    "side_offer",
    "carton",
    "bundle",
]


# ============================================================
# PROMOTION
# ============================================================


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

    store_format: str | None = Field(
        default=None,
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

    skus: list[SkuItem] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_period(self):
        if self.period_end < self.period_start:
            raise ValueError(
                "period_end cannot be earlier than period_start"
            )

        return self

    @model_validator(mode="after")
    def validate_unique_skus(self):
        codes = [item.sku for item in self.skus]

        duplicates = {
            code
            for code in codes
            if codes.count(code) > 1
        }

        if duplicates:
            raise ValueError(
                "duplicate sku codes in payload: "
                + ", ".join(sorted(duplicates))
            )

        return self


class PromotionCreate(PromotionBase):
    pass


class PromotionUpdate(PromotionBase):
    pass
