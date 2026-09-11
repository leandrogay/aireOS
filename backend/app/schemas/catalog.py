from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


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
