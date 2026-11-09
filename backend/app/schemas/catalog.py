import re
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _Base(BaseModel):
    # Strips leading/trailing whitespace on every str field.
    # This is why the service layer no longer calls .strip()
    # everywhere.
    model_config = ConfigDict(str_strip_whitespace=True)


# ============================================================
# NAMES
#
# Retailer names are stored as lowercase slugs (fairprice_online):
# the dashboard, promotions and uploads all look them up by that
# exact text, so every retailer name a user types is normalised
# here before it reaches a service.
#
# Customer names keep the capitals the user typed (FairPrice, NHG)
# because they are what people read on every page; only spaces and
# hyphens become underscores (Sheng Shiong -> Sheng_Shiong). Nothing
# derives a lookup key from them: a customer's retailers are linked
# by id (customer_retailers) and their own names stay slugs.
#
# The frontend mirrors both in customerForm.js (normaliseName,
# cleanCustomerName).
# ============================================================


_SEPARATORS = re.compile(r"[\s\-]+")
_SLUG = re.compile(r"^[a-z0-9_]+$")
_CUSTOMER_NAME = re.compile(r"^[A-Za-z0-9_]+$")
_NAME_CHARACTERS = "Use only letters, numbers, spaces, hyphens or underscores."


def normalise_name(value: str) -> str:
    """'Giant Online' -> 'giant_online'; rejects anything but letters, digits, spaces, hyphens and underscores."""

    slug = _SEPARATORS.sub("_", value.lower()).strip("_")

    if not slug:
        raise ValueError("Enter a name.")

    if not _SLUG.match(slug):
        raise ValueError(_NAME_CHARACTERS)

    return slug


def clean_customer_name(value: str) -> str:
    """'Sheng Shiong' -> 'Sheng_Shiong', 'FairPrice' stays 'FairPrice'; same characters as normalise_name, case kept."""

    name = _SEPARATORS.sub("_", value).strip("_")

    if not name:
        raise ValueError("Enter a name.")

    if not _CUSTOMER_NAME.match(name):
        raise ValueError(_NAME_CHARACTERS)

    return name


# ============================================================
# CUSTOMER
# ============================================================


class CustomerBase(_Base):
    customer_name: str = Field(
        min_length=1,
        max_length=255,
    )

    @field_validator("customer_name")
    @classmethod
    def _clean(cls, value: str) -> str:
        return clean_customer_name(value)


class CustomerCreate(CustomerBase):
    # Retailers created (or, when an upload already made them, linked) under
    # the new customer in the same transaction -- the mapping review creates a
    # customer together with the <name>_offline / <name>_online retailers its
    # file writes to.
    retailer_names: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("retailer_names")
    @classmethod
    def _slugs(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(normalise_name(value) for value in values))


class CustomerUpdate(CustomerBase):
    pass


# ============================================================
# RETAILER
# ============================================================


class RetailerBase(_Base):
    retailer_name: str = Field(
        min_length=1,
        max_length=255,
    )

    @field_validator("retailer_name")
    @classmethod
    def _slug(cls, value: str) -> str:
        return normalise_name(value)


class RetailerCreate(RetailerBase):
    # Every retailer belongs to a customer (customer_retailers).
    customer_id: int = Field(gt=0)


class RetailerUpdate(RetailerBase):
    pass


class RetailerLink(_Base):
    customer_id: int = Field(gt=0)


# ============================================================
# STORE
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


class SkuBase(_Base):
    sku_range: str = Field(
        min_length=1,
        max_length=255,
    )

    product_name: str = Field(
        min_length=1,
        max_length=255,
    )

    size: str = Field(
        min_length=1,
        max_length=100,
    )

    brand: str = Field(
        min_length=1,
        max_length=255,
    )

    uom: str = Field(
        min_length=1,
        max_length=50,
    )

    pack_size: int = Field(gt=0)

    price: Decimal = Field(
        ge=0,
        max_digits=10,
        decimal_places=2,
    )

    price_effective_from: date | None = None
    price_effective_to: date | None = None

    @model_validator(mode="after")
    def valid_price_period(self):
        if self.price_effective_to and not self.price_effective_from:
            raise ValueError("Effective from is required when Effective to is set")
        if (self.price_effective_from and self.price_effective_to
                and self.price_effective_to < self.price_effective_from):
            raise ValueError("Effective to cannot be before Effective from")
        return self


class SkuCreate(SkuBase):
    sku: str = Field(
        min_length=1,
        max_length=100,
    )


class SkuUpdate(SkuBase):
    """Editable SKU fields. The immutable SKU code comes from the URL."""

    price_changed: bool | None = None


class SkuPricePeriodCorrection(_Base):
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("Effective to cannot be before Effective from")
        return self
