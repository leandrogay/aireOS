from datetime import date, datetime, timezone
from decimal import Decimal

from app.services.settings import promo_anchor_versions as versions
from app.services.settings import promo_uplift_calc as service


STAMP = datetime(2026, 11, 10, tzinfo=timezone.utc)
NOV_2026 = date(2026, 11, 1)
JUNE_2027 = date(2027, 6, 1)

CUSTOMERS = [{"customer_id": 1, "customer_name": "FairPrice"}]
PRODUCTS = {
    "SKU-L": {"product_name": "Aire Pants L", "sku_range": "Pants"},
    "SKU-XL": {"product_name": "Aire Pants XL", "sku_range": "Pants"},
}
MECHANICS = {
    "pct_off_15": {"label": "15% Off", "discount_pct": Decimal("15")},
    "pct_off_20": {"label": "20% Off", "discount_pct": Decimal("20")},
    "pct_off_30": {"label": "30% Off", "discount_pct": Decimal("30")},
    "voucher": {"label": "Voucher", "discount_pct": None},
}


def _anchor(anchor_id, mechanic, pct, effective_from=None):
    return {
        "id": anchor_id, "customer_id": 1, "sku_range": None, "promotion_mechanic": mechanic,
        "anchor_pct": Decimal(pct), "source": "recommended", "effective_from": effective_from, "updated_at": STAMP,
    }


def _saved(sku, mechanic_key, anchor_id, level, uplift_pct):
    return {
        "customer_id": 1, "sku": sku, "mechanic_key": mechanic_key, "anchor_id": anchor_id, "version_from": None,
        "level": level, "uplift_pct": uplift_pct,
        "explanation": {"anchor": {"version_id": anchor_id}, "moments": [{"month": "2026-07-01"}], "placeholder": None},
    }


def _rows(calc_rows, anchor_rows, months=(NOV_2026,)):
    return service.calculated_rows(
        calc_rows, CUSTOMERS, PRODUCTS, MECHANICS, versions.version_lookup(anchor_rows), list(months)
    )


def _row(rows, mechanic_key):
    return next(row for row in rows if row["mechanic_key"] == mechanic_key)


# ---- one version ---------------------------------------------------------------------


def test_every_customer_range_and_mechanic_has_a_row():
    rows = _rows([], [_anchor(1, "20% Off", "20")])

    assert [(row["sku_range"], row["mechanic_label"]) for row in rows] == [
        ("Pants", "15% Off"), ("Pants", "20% Off"), ("Pants", "30% Off"), ("Pants", "Voucher"),
    ]


def test_a_mechanic_with_no_moments_is_the_placeholder_against_the_anchor():
    version, = _row(_rows([], [_anchor(1, "20% Off", "20")]), "pct_off_30")["versions"]

    assert (version["level"], version["uplift_min"], version["uplift_max"]) == ("placeholder", 4.0, 4.0)
    assert version["skus"][0]["placeholder"] == {"discount_pct": 30.0, "anchor_pct": 20.0}


def test_the_anchor_mechanic_is_level_anchor_at_0():
    version, = _row(_rows([], [_anchor(1, "20% Off", "20")]), "pct_off_20")["versions"]

    assert (version["level"], version["uplift_min"]) == ("anchor", 0.0)


def test_a_mechanic_with_no_discount_and_no_moments_is_unavailable():
    version, = _row(_rows([], [_anchor(1, "20% Off", "20")]), "voucher")["versions"]

    assert (version["level"], version["uplift_min"]) == ("unavailable", None)


def test_a_saved_value_is_used_and_the_range_reads_as_its_weakest_sku():
    calc = [_saved("SKU-L", "pct_off_30", 1, "measured", 9.0)]

    version, = _row(_rows(calc, [_anchor(1, "20% Off", "20")]), "pct_off_30")["versions"]

    assert [(sku["sku"], sku["level"], sku["uplift_pct"]) for sku in version["skus"]] == [
        ("SKU-L", "measured", 9.0), ("SKU-XL", "placeholder", 4.0),
    ]
    assert version["skus"][0]["moments"] == [{"month": "2026-07-01"}]
    assert (version["level"], version["uplift_min"], version["uplift_max"]) == ("placeholder", 4.0, 9.0)
    assert version["levels"] == {"measured": 1, "placeholder": 1}


# ---- versions ------------------------------------------------------------------------


def test_an_upcoming_anchor_is_a_second_version_from_its_month():
    anchors = [_anchor(1, "20% Off", "20"), _anchor(2, "15% Off", "15", JUNE_2027)]

    row = _row(_rows([], anchors, months=(NOV_2026, JUNE_2027)), "pct_off_30")

    assert [(v["effective_from"], v["anchor"]["mechanic_label"], v["uplift_min"]) for v in row["versions"]] == [
        ("2026-11-01", "20% Off", 4.0),
        ("2027-06-01", "15% Off", 6.0),
    ]


def test_a_month_with_no_change_for_this_target_adds_no_version():
    anchors = [_anchor(1, "20% Off", "20"), {**_anchor(2, "15% Off", "15", JUNE_2027), "customer_id": 2}]

    row = _row(_rows([], anchors, months=(NOV_2026, JUNE_2027)), "pct_off_30")

    assert [v["effective_from"] for v in row["versions"]] == ["2026-11-01"]


def test_with_no_anchor_saved_the_moments_say_which_mechanic_is_the_anchor():
    calc = [{**_saved("SKU-L", "pct_off_30", None, "measured", 9.0),
             "explanation": {"anchor": {"version_id": None, "mechanic_key": "pct_off_20"}, "moments": []}}]

    version, = _row(_rows(calc, []), "pct_off_20")["versions"]

    # SKU-L's moments ran 20% off most; SKU-XL has none, so 20% off is a placeholder there.
    assert [(sku["sku"], sku["level"]) for sku in version["skus"]] == [("SKU-L", "anchor"), ("SKU-XL", "placeholder")]
    assert version["anchor"]["anchor_pct"] == 20.0
