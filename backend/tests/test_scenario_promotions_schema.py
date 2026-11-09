import pytest
from pydantic import ValidationError

from app.schemas.scenario.promotions import ScenarioPromotionCreate


def _promotion(**changes):
    promotion = {
        "customer_name": "fairprice",
        "sku_ranges": ["Ultra Tape"],
        "product_name": None,
        "promo_type": "monthly",
        "mechanic_key": "pct_off_30",
        "mechanic_label": "30% Off",
        "reference_uplift_pct": 4,
        "reference_source": "placeholder",
        "start_month": "2027-03-01",
        "end_month": "2027-03-01",
    }
    promotion.update(changes)
    return promotion


# ---- SKU ranges --------------------------------------------------------------


def test_a_promotion_for_several_sku_ranges_keeps_each_once_in_order():
    promotion = ScenarioPromotionCreate(**_promotion(sku_ranges=["Ultra Tape", "Comfort Pants", "Ultra Tape"]))

    assert promotion.sku_ranges == ["Comfort Pants", "Ultra Tape"]


@pytest.mark.parametrize("sku_ranges", [None, []], ids=["none", "empty"])
def test_no_ranges_means_all_sku_ranges(sku_ranges):
    assert ScenarioPromotionCreate(**_promotion(sku_ranges=sku_ranges)).sku_ranges is None


def test_a_promotion_saved_on_one_sku_before_ranges_can_still_be_saved():
    promotion = ScenarioPromotionCreate(**_promotion(sku_ranges=None, product_name="Aire Ultra Tape L"))

    assert promotion.product_name == "Aire Ultra Tape L"


def test_a_promotion_cannot_name_both_ranges_and_one_sku():
    with pytest.raises(ValidationError):
        ScenarioPromotionCreate(**_promotion(product_name="Aire Ultra Tape L"))
