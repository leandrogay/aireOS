from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.catalog import _Base
from app.schemas.scenario.building_blocks import ExcludedPair, excluded_pairs_in_order_once


# ============================================================
# SCENARIO PROMOTIONS
#
# Mirrors the scenario_promotions CHECKs (018), which stay as the
# backstop. Customer and product are named the way the Forecast page
# names them, like building blocks; the service resolves them to
# customer_id / sku. The frontend builds this body in
# buildScenarioPromotionPayload (app/utils/scenarioPromotions.js).
# ============================================================


# Same values as PROMO_OVERLAY_TYPES in app/utils/forecastView.js.
ScenarioPromoType = Literal["monthly", "side_offer", "bundle", "others"]

# Same bounds as promo_uplift_settings.uplift_pct (migration 012).
_UPLIFT = {"ge": Decimal("-90"), "le": Decimal("300"), "max_digits": 6, "decimal_places": 2}


class ReferenceDetail(_Base):
    """The calculation explanation kept with one customer's copied product uplift."""

    product_name: str = Field(min_length=1, max_length=255)
    sku_range: str | None = Field(default=None, max_length=255)
    uplift_pct: float = Field(ge=-90, le=300, allow_inf_nan=False)
    level: str = Field(min_length=1, max_length=20)
    lines: list[Annotated[str, Field(max_length=1000)]] = Field(default_factory=list, max_length=20)


class CustomerReferences(_Base):
    """One customer's values copied in from Promotion Uplift Settings (migration 025)."""

    reference_uplift_pct: Decimal = Field(**_UPLIFT)
    reference_source: str = Field(min_length=1, max_length=20)
    reference_by_sku: dict[str, Decimal] = Field(default_factory=dict)
    voucher_uplift_pct: Decimal = Field(default=Decimal("0"), **_UPLIFT)
    voucher_by_sku: dict[str, Decimal] = Field(default_factory=dict)
    reference_details: list[ReferenceDetail] = Field(default_factory=list, max_length=1000)


class ScenarioPromotionBase(_Base):
    plan: Literal["scenario", "budget"] = "scenario"

    # Like building blocks: several customers (migration 022), None (or an
    # empty list) = every customer; each customer x SKU range can be
    # switched off on its own (023).
    customer_names: list[str] | None = Field(default=None, max_length=100)
    excluded_pairs: list[ExcludedPair] = Field(default_factory=list, max_length=1000)

    # Promotions are planned by SKU range: sku_ranges = every SKU of those
    # ranges; None (or empty) with no product_name = all SKU ranges.
    # product_name (one SKU) is only for promotions saved before ranges, so
    # they can still be edited; never both.
    sku_ranges: list[str] | None = Field(default=None, max_length=100)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)

    promo_type: ScenarioPromoType
    mechanic_key: str = Field(min_length=1, max_length=40)
    mechanic_label: str = Field(min_length=1, max_length=120)

    # Copied from Promotion Uplift Settings when the promotion was set up,
    # so a later settings change does not move a saved promotion: each
    # customer's in references_by_customer (by name), the first customer's
    # also in the single fields below.
    references_by_customer: dict[str, CustomerReferences] = Field(default_factory=dict)
    reference_uplift_pct: Decimal = Field(**_UPLIFT)
    reference_source: str = Field(min_length=1, max_length=20)
    reference_by_sku: dict[str, Decimal] = Field(default_factory=dict)

    override_uplift_pct: Decimal | None = Field(default=None, **_UPLIFT)

    voucher: bool = False
    voucher_uplift_pct: Decimal = Field(default=Decimal("0"), **_UPLIFT)
    voucher_by_sku: dict[str, Decimal] = Field(default_factory=dict)

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

    @field_validator("customer_names")
    @classmethod
    def _customers_in_order_once(cls, value: list[str] | None) -> list[str] | None:
        # Same rule as building blocks: nothing left = every customer (None).
        names = sorted({item.strip() for item in value or [] if item and item.strip()})
        if any(len(item) > 255 for item in names):
            raise ValueError("A customer name is at most 255 characters")
        return names or None

    @field_validator("excluded_pairs")
    @classmethod
    def _pairs_in_order_once(cls, value: list[ExcludedPair]) -> list[ExcludedPair]:
        return excluded_pairs_in_order_once(value)

    @field_validator("sku_ranges")
    @classmethod
    def _ranges_in_order_once(cls, value: list[str] | None) -> list[str] | None:
        # Same rule as building blocks: nothing left = all ranges (None).
        ranges = sorted({item.strip() for item in value or [] if item and item.strip()})
        return ranges or None

    @model_validator(mode="after")
    def validate_promotion(self):
        if self.start_month.day != 1 or self.end_month.day != 1:
            raise ValueError("start_month and end_month must be the first day of a month")

        if self.plan == "budget" and self.start_month.year != self.end_month.year:
            raise ValueError("Budget entries must stay within one calendar year")

        if self.end_month < self.start_month:
            raise ValueError("end_month cannot be before start_month")

        if self.sku_ranges and self.product_name is not None:
            raise ValueError("A promotion covers SKU ranges or one SKU, not both")

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

        per_sku = [self.reference_by_sku, self.voucher_by_sku]
        for references in self.references_by_customer.values():
            per_sku += [references.reference_by_sku, references.voucher_by_sku]
        for values in per_sku:
            if any(value < Decimal("-90") or value > Decimal("300") for value in values.values()):
                raise ValueError("Per-SKU uplifts must be between -90% and 300%")

        if self.customer_names and set(self.references_by_customer) - set(self.customer_names):
            raise ValueError("references_by_customer names a customer the promotion doesn't cover")

        return self


class ScenarioPromotionCreate(ScenarioPromotionBase):
    pass


class ScenarioPromotionUpdate(ScenarioPromotionBase):
    pass
