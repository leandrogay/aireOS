from decimal import Decimal

from pydantic import Field

from app.schemas.catalog import _Base


# ============================================================
# PROMOTION UPLIFT SETTINGS
#
# Discounts and anchor_pct are NUMERIC(5,2) between 0 and 100. The table
# CHECKs stay as the backstop.
# ============================================================

# A mechanic's effective discount (NUMERIC(5,2)). Uplifts themselves are
# never typed: they are worked out (promo_recalc).
class MechanicDiscountUpdate(_Base):
    effective_discount_pct: Decimal = Field(gt=0, le=100, max_digits=5, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)


# The fallback anchor: the discount of an ordinary month wherever a customer
# x SKU range has no anchor of its own or its customer's.
class PromoFallbackAnchorUpdate(_Base):
    anchor_pct: Decimal = Field(ge=0, le=100, max_digits=5, decimal_places=2)


# An overwrite picks one of the mechanics the customer's official promotions
# use (the entry's mechanic_options), never a typed %. sku_range: one of the
# customer's SKU ranges; None = the whole customer.
class PromoAnchorOverwrite(_Base):
    mechanic_key: str = Field(min_length=1, max_length=50)
    sku_range: str | None = Field(default=None, min_length=1, max_length=255)


class PromoAnchorAdopt(_Base):
    sku_range: str | None = Field(default=None, min_length=1, max_length=255)
