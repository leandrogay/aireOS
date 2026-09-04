from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


PromoType = Literal[
    "regular",
    "side_offer",
    "carton",
    "bundle",
]


class _Base(BaseModel):
    # Strips leading/trailing whitespace on every str field.
    # This is why the service layer no longer calls .strip()
    # everywhere.
    model_config = ConfigDict(str_strip_whitespace=True)


# ============================================================
# RETAILER
# ============================================================


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


# ============================================================
# STORE
#
# store_code is VARCHAR(100) in the schema, not an integer.
# It is only unique within a retailer.
# ============================================================


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

    store_format: str | None = Field(
        default=None,
        max_length=100,
    )


class StoreCreate(StoreBase):
    pass


class StoreUpdate(StoreBase):
    pass


# ============================================================
# SKU
#
# Everything except `sku` is optional so a partially known
# product can still be recorded. quantity_units is a property
# of the SKU *within this promotion*, not of the SKU itself,
# and is stored on promotion_skus.
# ============================================================


class SkuItem(_Base):
    sku: str = Field(
        min_length=1,
        max_length=100,
    )

    sku_range: str | None = Field(
        default=None,
        max_length=255,
    )

    product_name: str | None = Field(
        default=None,
        max_length=255,
    )

    product_category: str | None = Field(
        default=None,
        max_length=255,
    )

    size: str | None = Field(
        default=None,
        max_length=100,
    )

    brand: str | None = Field(
        default=None,
        max_length=255,
    )

    uom: str | None = Field(
        default=None,
        max_length=50,
    )

    pack_size: int | None = Field(
        default=None,
        ge=0,
    )

    price: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=10,
        decimal_places=2,
    )

    quantity_units: int | None = Field(
        default=None,
        ge=0,
    )


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