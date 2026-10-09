import pytest
from pydantic import ValidationError

from app.schemas.catalog import CustomerCreate, RetailerCreate, RetailerUpdate


# ---- name slugs ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("Giant", "giant"),
        ("  Giant Online  ", "giant_online"),
        ("Cold  Storage", "cold_storage"),
        ("7-Eleven", "7_eleven"),
        ("fairprice_online", "fairprice_online"),
    ],
)
def test_names_are_stored_as_lowercase_slugs(typed, stored):
    assert CustomerCreate(customer_name=typed).customer_name == stored
    assert RetailerUpdate(retailer_name=typed).retailer_name == stored


@pytest.mark.parametrize("typed", ["", "   ", " - "])
def test_an_empty_name_is_rejected(typed):
    with pytest.raises(ValidationError):
        CustomerCreate(customer_name=typed)


def test_a_name_with_symbols_is_rejected():
    with pytest.raises(ValidationError, match="letters, numbers"):
        RetailerUpdate(retailer_name="Giant & Co")


def test_a_new_retailer_needs_a_customer():
    with pytest.raises(ValidationError):
        RetailerCreate(retailer_name="giant_online")

    assert RetailerCreate(retailer_name="Giant Online", customer_id=3).customer_id == 3
