from decimal import Decimal

import pytest

from app.services.settings import promo_uplift_rules as rules


# ---- mechanic_key ----------------------------------------------------------------

# Every label in the promotions table on 21 Oct 2026, plus spacing/case variants.
@pytest.mark.parametrize(
    "label, key",
    [
        ("5% Off", "pct_off_5"),
        ("10% Off", "pct_off_10"),
        ("15% Off", "pct_off_15"),
        ("20% Off", "pct_off_20"),
        ("25% Off", "pct_off_25"),
        ("25%", "pct_off_25"),
        ("25 % OFF", "pct_off_25"),
        ("27% Off", "pct_off_27"),
        ("30% Off", "pct_off_30"),
        ("Buy 2 Get 25% Off", "b2_pct_off_25"),
        ("Buy 2 Get 25%", "b2_pct_off_25"),
        ("Buy 2 Get 30% Off", "b2_pct_off_30"),
        ("Buy 2 Get 1 Free", "b2g1"),
        ("Buy 1 Get 1 Free", "b1g1"),
        ("B1G1", "b1g1"),
        ("Voucher", "voucher"),
        ("  voucher ", "voucher"),
    ],
)
def test_real_mechanic_labels_match_their_key(label, key):
    assert rules.mechanic_key(label) == key


@pytest.mark.parametrize("label", [None, "", "Free tote bag", "Gift with purchase", "30 Off"])
def test_unreadable_labels_have_no_key(label):
    assert rules.mechanic_key(label) is None


# ---- voucher_flag ----------------------------------------------------------------


@pytest.mark.parametrize(
    "voucher",
    ["$3 off $30", "$2 off $20", "$3 off $28", "$4.50 off $45", "$5 off $50", "$4 off $20", "Yes"],
)
def test_any_voucher_text_is_a_voucher(voucher):
    assert rules.voucher_flag(voucher) == 1


@pytest.mark.parametrize("voucher", [None, "", "   ", "No", "none", "N/A", "-", "0"])
def test_blank_or_no_voucher_is_not_a_voucher(voucher):
    assert rules.voucher_flag(voucher) == 0


def test_a_voucher_mechanic_counts_as_a_voucher_even_with_no_amount():
    assert rules.voucher_flag(None, mechanic="Voucher") == 1


# ---- placeholder_uplift ------------------------------------------------------------


@pytest.mark.parametrize(
    "discount, anchor_20, anchor_30",
    [
        ("5", -6, -10),
        ("20", 0, -4),
        ("27", 3, -1),
        ("30", 4, 0),
        ("33.3", 5, 1),
        ("50", 12, 8),
    ],
)
def test_placeholder_uplift_moves_with_the_anchor(discount, anchor_20, anchor_30):
    assert rules.placeholder_uplift(Decimal(discount), Decimal("20")) == anchor_20
    assert rules.placeholder_uplift(Decimal(discount), Decimal("30")) == anchor_30
