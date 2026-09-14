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
# PROMOTION STORE
#
# One promotion runs in many stores. Each entry names a store
# the same way the catalog does (retailer + store_code), so
# the service can resolve it through get_or_create_store and
# link it via promotion_stores.
# ============================================================


class PromotionStoreRef(_Base):
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


# ============================================================
# PROMOTION
# ============================================================


class PromotionBase(_Base):
    stores: list[PromotionStoreRef] = Field(min_length=1)

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
    def validate_unique_stores(self):
        # (retailer, store_code) is the stores natural key, so
        # the same pair twice would collapse to one
        # promotion_stores row and silently drop the duplicate.
        keys = [
            (item.retailer, item.store_code)
            for item in self.stores
        ]

        duplicates = {
            f"{retailer}/{store_code}"
            for retailer, store_code in keys
            if keys.count((retailer, store_code)) > 1
        }

        if duplicates:
            raise ValueError(
                "duplicate stores in payload: "
                + ", ".join(sorted(duplicates))
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
