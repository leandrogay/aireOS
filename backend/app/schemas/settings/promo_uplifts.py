from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.settings.common import SettingsChangeBase
from app.services.settings import promo_uplift_rules as rules


# ============================================================
# PROMOTION UPLIFT SETTINGS
#
# uplift_pct is NUMERIC(6,2) between -90 and 300 (4 means +4%; negative
# means a month with that mechanic sells less than an ordinary month).
# anchor_pct is NUMERIC(5,2) between 0 and 100. The table CHECKs stay as
# the backstop.
# ============================================================

class PromoUpliftUpdate(SettingsChangeBase):
    uplift_pct: Decimal = Field(ge=-90, le=300, max_digits=6, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)


class PromoUpliftReset(SettingsChangeBase):
    pass


class PromoUpliftOverrideCreate(SettingsChangeBase):
    mechanic_key: str = Field(min_length=1, max_length=50)
    scope: Literal["customer", "range", "sku"]
    customer_id: int
    sku_range: str | None = Field(default=None, min_length=1, max_length=255)
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    uplift_pct: Decimal = Field(ge=-90, le=300, max_digits=6, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_scope_columns(self):
        if self.scope == "range" and (self.sku_range is None or self.sku is not None):
            raise ValueError("a range override needs sku_range and no sku")

        if self.scope == "sku" and (self.sku is None or self.sku_range is not None):
            raise ValueError("a SKU override needs sku and no sku_range")

        if self.scope == "customer" and (self.sku is not None or self.sku_range is not None):
            raise ValueError("a customer override takes neither sku nor sku_range")

        return self


class PromoAnchorUpdate(SettingsChangeBase):
    anchor_pct: Decimal = Field(ge=0, le=100, max_digits=5, decimal_places=2)


class PromoAnchorReset(SettingsChangeBase):
    pass


class PromoUpliftArchive(SettingsChangeBase):
    pass


class PromoMechanicCreate(SettingsChangeBase):
    kind: Literal["promotion", "voucher"] = "promotion"
    mechanic_label: str = Field(min_length=1, max_length=100)
    effective_discount_pct: Decimal | None = Field(default=None, ge=0, le=100, max_digits=5, decimal_places=2)
    # None = a rule-based uplift that follows the rule and each customer's anchor.
    uplift_pct: Decimal | None = Field(default=None, ge=-90, le=300, max_digits=6, decimal_places=2)
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_mechanic(self):
        # A promotion's key is read from its label (promo_uplift_rules.mechanic_key),
        # so it matches the promotions that use it.
        if self.kind == "promotion" and rules.mechanic_key(self.mechanic_label) in (None, rules.VOUCHER_KEY):
            raise ValueError(
                'the label cannot be read as a mechanic; use a form like "35% Off", '
                '"Buy 2 Get 30% Off" or "Buy 3 Get 1 Free"'
            )

        if self.kind == "voucher" and self.uplift_pct is None and self.effective_discount_pct is None:
            raise ValueError("a voucher with no discount needs an uplift")

        return self


class PromoNoteDecision(SettingsChangeBase):
    pass


class PromoRuleUpdate(SettingsChangeBase):
    # The rule behind rule-based uplifts: % sales rise per extra point of
    # discount deeper than normal. No upper limit (a high rate only shapes
    # planning values, and is warned about); NUMERIC(6,2) in the database.
    uplift_per_point_pct: Decimal = Field(max_digits=6, decimal_places=2)

    @field_validator("uplift_per_point_pct")
    @classmethod
    def _positive(cls, value: Decimal) -> Decimal:
        if value <= 0:
            raise ValueError("the rate must be more than 0% per point")
        return value


class PromoRuleReset(SettingsChangeBase):
    pass
