import pytest
from pydantic import ValidationError

from app.schemas.catalog import CustomerCreate, RetailerCreate, RetailerUpdate


# ---- names -----------------------------------------------------------------------


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
def test_retailer_names_are_stored_as_lowercase_slugs(typed, stored):
    assert RetailerUpdate(retailer_name=typed).retailer_name == stored


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("FairPrice", "FairPrice"),
        ("NHG", "NHG"),
        ("  Sheng Shiong  ", "Sheng_Shiong"),
        ("Cold  Storage", "Cold_Storage"),
        ("7-Eleven", "7_Eleven"),
        ("giant", "giant"),
    ],
)
def test_customer_names_keep_their_capitals_with_spaces_as_underscores(typed, stored):
    assert CustomerCreate(customer_name=typed).customer_name == stored


def test_retailers_named_with_a_new_customer_are_still_slugs():
    customer = CustomerCreate(customer_name="FairPrice", retailer_names=["FairPrice Offline"])

    assert customer.retailer_names == ["fairprice_offline"]


def test_a_customer_name_with_symbols_is_rejected():
    with pytest.raises(ValidationError, match="letters, numbers"):
        CustomerCreate(customer_name="Giant & Co")


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
