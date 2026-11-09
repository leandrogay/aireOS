from decimal import Decimal
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.catalog import _Base


# ============================================================
# PROMOTION UPLIFT SETTINGS
#
# uplift_pct is NUMERIC(6,2) between -90 and 300 (4 means +4%; negative
# means a month with that mechanic sells less than an ordinary month).
# anchor_pct is NUMERIC(5,2) between 0 and 100. The table CHECKs stay as
# the backstop.
# ============================================================

class PromoUpliftUpdate(_Base):
    uplift_pct: Decimal = Field(ge=-90, le=300, max_digits=6, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)


# Uplifts and anchors follow SKU ranges: an override is for a whole customer
# or one of its SKU ranges, never one SKU. SKU-level rows saved before this
# stay in the history but no longer apply (promo_uplifts._applies).
class PromoUpliftOverrideCreate(_Base):
    mechanic_key: str = Field(min_length=1, max_length=50)
    scope: Literal["customer", "range"]
    customer_id: int
    sku_range: str | None = Field(default=None, min_length=1, max_length=255)
    uplift_pct: Decimal = Field(ge=-90, le=300, max_digits=6, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_scope_columns(self):
        if self.scope == "range" and self.sku_range is None:
            raise ValueError("a range override needs sku_range")

        if self.scope == "customer" and self.sku_range is not None:
            raise ValueError("a customer override takes no sku_range")

        return self


# sku_range: one of the customer's SKU ranges; None = the whole customer.
class PromoAnchorUpdate(_Base):
    anchor_pct: Decimal = Field(ge=0, le=100, max_digits=5, decimal_places=2)
    sku_range: str | None = Field(default=None, min_length=1, max_length=255)


class PromoAnchorAdopt(_Base):
    sku_range: str | None = Field(default=None, min_length=1, max_length=255)
