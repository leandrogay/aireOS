from datetime import date

from pydantic import Field, field_validator

from app.schemas.catalog import _Base


def _check_customer_ids(ids: list[int]) -> list[int]:
    if any(customer_id <= 0 for customer_id in ids):
        raise ValueError("customer_ids must be positive integers")
    if len(set(ids)) != len(ids):
        raise ValueError("customer_ids must not repeat")
    return ids


# ============================================================
# INVENTORY RECORD
#
# One month of movement for one SKU, applied to one or more
# customers. Quantities are EA-equivalent units, never negative.
# Ending stock and DOH are derived, so they are not accepted here.
# ============================================================


class InventoryRecordBase(_Base):
    customer_ids: list[int] = Field(min_length=1)

    sku: str = Field(
        min_length=1,
        max_length=64,
    )

    # First day of the month being recorded (the UI sends YYYY-MM-01).
    month: date

    # Sell-in is the only quantity entered: sell-out comes from the sales
    # dashboard's data, so it is not accepted here. Units are whole numbers.
    sell_in: int = Field(ge=0)

    # Only used to seed a SKU's very first month; later months
    # derive their opening stock from the previous ending stock.
    opening_inventory: int | None = Field(default=None, ge=0)

    @field_validator("customer_ids")
    @classmethod
    def _customers_must_be_positive_and_unique(cls, ids):
        return _check_customer_ids(ids)

    @field_validator("month")
    @classmethod
    def _month_must_be_the_first_day(cls, value):
        if value.day != 1:
            raise ValueError("month must be the first day of a month (YYYY-MM-01)")
        return value


class InventoryRecordCreate(InventoryRecordBase):
    pass


class InventoryRecordUpdate(InventoryRecordBase):
    pass


# ============================================================
# SHIPPED SO FAR
#
# Sell-in already sent in a month that has not ended. Used only by the
# sell-in plan; the finished month's actuals go through InventoryRecord*.
# ============================================================


class ShippedSoFarUpdate(_Base):
    customer_ids: list[int] = Field(min_length=1)

    sku: str = Field(
        min_length=1,
        max_length=64,
    )

    # First day of the month the units were shipped for (YYYY-MM-01).
    month: date

    shipped_so_far: int = Field(ge=0)

    @field_validator("customer_ids")
    @classmethod
    def _customers_must_be_positive_and_unique(cls, ids):
        return _check_customer_ids(ids)

    @field_validator("month")
    @classmethod
    def _month_must_be_the_first_day(cls, value):
        if value.day != 1:
            raise ValueError("month must be the first day of a month (YYYY-MM-01)")
        return value


# ============================================================
# DOH THRESHOLD
#
# Only the target is stored; min and max are derived from it.
# ============================================================


class DohThresholdUpdate(_Base):
    customer_ids: list[int] = Field(min_length=1)

    # Whole days, at least 1 (the database also requires > 0).
    target_doh: int = Field(ge=1)

    @field_validator("customer_ids")
    @classmethod
    def _customers_must_be_positive_and_unique(cls, ids):
        return _check_customer_ids(ids)
