import pytest
from pydantic import ValidationError

from app.schemas.promotions import PromotionCreate


def _payload(**overrides) -> dict:
    base = {
        "stores": [
            {
                "retailer": "fairprice",
                "store_name": "Bedok Mall",
                "store_code": "BM01",
            }
        ],
        "period_start": "2026-01-01",
        "period_end": "2026-01-31",
        "promo_type": "monthly",
    }
    base.update(overrides)
    return base


# ---- promo_type ----


@pytest.mark.parametrize(
    "value",
    [
        "monthly",
        "side_offer",
        "bundle",
        "others",
        "carton_monthly",
        "carton_side_offer",
        "carton_bundle",
        "carton_others",
    ],
)
def test_every_pack_and_carton_type_is_accepted(value):
    promotion = PromotionCreate(**_payload(promo_type=value))
    assert promotion.promo_type == value


@pytest.mark.parametrize("value", ["regular", "carton", "Monthy", "pack_monthly", ""])
def test_unknown_promo_type_is_rejected(value):
    with pytest.raises(ValidationError):
        PromotionCreate(**_payload(promo_type=value))
