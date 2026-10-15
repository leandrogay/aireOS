import re
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Base(BaseModel):
    # Strips leading/trailing whitespace on every str field.
    # This is why the service layer no longer calls .strip()
    # everywhere.
    model_config = ConfigDict(str_strip_whitespace=True)


# ============================================================
# NAME SLUGS
#
# Customer and retailer names are stored as lowercase slugs
# (fairprice, fairprice_online): the dashboard, promotions and
# uploads all look them up by that exact text, so every name a
# user types is normalised here before it reaches a service.
# The frontend mirrors this in normaliseName (customerForm.js).
# ============================================================


_SEPARATORS = re.compile(r"[\s\-]+")
_SLUG = re.compile(r"^[a-z0-9_]+$")


def normalise_name(value: str) -> str:
    """'Giant Online' -> 'giant_online'; rejects anything but letters, digits, spaces, hyphens and underscores."""

    slug = _SEPARATORS.sub("_", value.lower()).strip("_")

    if not slug:
        raise ValueError("Enter a name.")

    if not _SLUG.match(slug):
        raise ValueError(
            "Use only letters, numbers, spaces, hyphens or underscores."
        )

    return slug


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
    def _slug(cls, value: str) -> str:
        return normalise_name(value)


class CustomerCreate(CustomerBase):
    pass


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
