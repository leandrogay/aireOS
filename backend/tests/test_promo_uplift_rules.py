from datetime import date
from decimal import Decimal

import pytest

from app.services.settings import promo_uplift_rules as rules


DISCOUNTS = {
    "pct_off_20": Decimal("20"),
    "pct_off_25": Decimal("25"),
    "pct_off_30": Decimal("30"),
    "b2_pct_off_30": Decimal("30"),
    "b1g1": Decimal("50"),
}


def _promo(start, end, mechanic, promo_type="monthly"):
    return {
        "period_start": start,
        "period_end": end,
        "promo_type": promo_type,
        "promotion_mechanic": mechanic,
    }


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


# ---- monthly_discounts -------------------------------------------------------------


def test_a_side_offer_replaces_the_monthly_discount_for_its_days():
    # June: 20% Off all month, 30% Off side offer on 7 days -> (23x20 + 7x30) / 30.
    promotions = [
        _promo(date(2026, 6, 1), date(2026, 6, 30), "20% Off"),
        _promo(date(2026, 6, 10), date(2026, 6, 16), "Buy 2 Get 30% Off", "side_offer"),
    ]

    monthly = rules.monthly_discounts(promotions, DISCOUNTS)

    assert round(monthly[date(2026, 6, 1)], 1) == Decimal("22.3")


def test_voucher_only_days_are_left_out():
    # 10 days of 20% Off, the rest of the month a voucher: only the 10 days count.
    promotions = [
        _promo(date(2026, 7, 1), date(2026, 7, 10), "20% Off"),
        _promo(date(2026, 7, 11), date(2026, 7, 31), "Voucher"),
    ]

    monthly = rules.monthly_discounts(promotions, DISCOUNTS)

    assert monthly == {date(2026, 7, 1): Decimal("20")}


def test_a_side_offer_still_counts_on_voucher_only_days():
    promotions = [
        _promo(date(2026, 7, 1), date(2026, 7, 31), "Voucher"),
        _promo(date(2026, 7, 5), date(2026, 7, 6), "Buy 1 Get 1 Free", "side_offer"),
    ]

    assert rules.monthly_discounts(promotions, DISCOUNTS) == {date(2026, 7, 1): Decimal("50")}


def test_the_deepest_side_offer_wins_when_two_overlap():
    promotions = [
        _promo(date(2026, 8, 1), date(2026, 8, 1), "25% Off", "side_offer"),
        _promo(date(2026, 8, 1), date(2026, 8, 1), "Buy 1 Get 1 Free", "side_offer"),
    ]

    assert rules.monthly_discounts(promotions, DISCOUNTS) == {date(2026, 8, 1): Decimal("50")}


def test_bundles_and_carton_types_count_like_their_base_type():
    promotions = [
        _promo(date(2026, 9, 1), date(2026, 9, 30), "20% Off", "carton_monthly"),
        _promo(date(2026, 9, 1), date(2026, 9, 30), "30% Off", "bundle"),
    ]

    assert rules.monthly_discounts(promotions, DISCOUNTS) == {date(2026, 9, 1): Decimal("30")}


def test_unreadable_mechanics_are_skipped():
    promotions = [_promo(date(2026, 9, 1), date(2026, 9, 30), "Free tote bag")]

    assert rules.monthly_discounts(promotions, DISCOUNTS) == {}


# ---- suggest_anchor ----------------------------------------------------------------


def test_the_suggestion_is_the_median_month_to_a_whole_percent():
    monthly = {
        date(2026, 1, 1): Decimal("20"),
        date(2026, 2, 1): Decimal("22.3"),
        date(2026, 3, 1): Decimal("30"),
    }

    suggestion = rules.suggest_anchor(monthly)

    assert suggestion == {
        "anchor_pct": Decimal("22"),
        "months_used": 3,
        "first_month": "2026-01-01",
        "last_month": "2026-03-01",
    }


def test_the_suggestion_only_uses_the_last_24_months_up_to_the_latest_promotion():
    monthly = {date(2023, 1, 1): Decimal("50")}
    for month in range(1, 13):
        monthly[date(2025, month, 1)] = Decimal("20")
        monthly[date(2026, month, 1)] = Decimal("20")

    suggestion = rules.suggest_anchor(monthly)

    assert suggestion["months_used"] == 24
    assert suggestion["first_month"] == "2025-01-01"
    assert suggestion["anchor_pct"] == Decimal("20")


def test_no_months_means_no_suggestion():
    assert rules.suggest_anchor({}) is None
