import datetime

import pytest
from conftest import FakeConnection, FakeEngine

from app.schemas.promotions import PromotionCreate
from app.services import forecast_refresh_events, promotion_service


# ---- helpers -----------------------------------------------------------------


def _payload(stores=None, skus=None) -> PromotionCreate:
    return PromotionCreate(
        stores=stores
        or [
            {"retailer": "fairprice", "store_name": "Bedok", "store_code": "BM01"},
        ],
        period_start="2026-01-01",
        period_end="2026-01-31",
        promo_type="monthly",
        skus=skus or [],
    )


# Stores already running the event, as (retailer_name, store_code) rows.
_COVERED_STORES_SQL = "TRIM(COALESCE(p.promotion_mechanic, '')) = :mechanic"


def _respond(sql, params, covered=()):
    """Canned Cloud SQL: one retailer, stores 10.. by position, two ranges."""
    if _COVERED_STORES_SQL in sql:
        return list(covered)

    if "INSERT INTO promotions" in sql:
        return [(99,)]

    if "INSERT INTO retailers" in sql:
        return [
            (name, index + 1)
            for index, name in enumerate(params["retailer_names"])
        ]

    if "INSERT INTO stores" in sql:
        return [
            (retailer_id, code, 10 + index)
            for index, (retailer_id, code) in enumerate(
                zip(params["retailer_ids"], params["store_codes"])
            )
        ]

    if "sku_range = ANY" in sql:
        catalog = {
            "Pants": [("Pants", "P-L"), ("Pants", "P-M")],
            "Tape": [("Tape", "T-1")],
        }
        return [
            row
            for name in params["sku_ranges"]
            for row in catalog.get(name, [])
        ]

    if "sku = ANY" in sql:
        return [(code,) for code in params["skus"] if code == "LOOSE-1"]

    if "FROM promotions p" in sql:
        return [{"promotion_id": params["promotion_id"], "stores": [], "skus": []}]

    return []


def _install_fake_engine(monkeypatch, respond=_respond):
    conn = FakeConnection(respond)
    monkeypatch.setattr(promotion_service, "_get_engine", lambda: FakeEngine(conn))
    # Every write records a forecast refresh; that has its own tests.
    monkeypatch.setattr(forecast_refresh_events, "record_change", lambda conn, kind, source: None)
    monkeypatch.setattr(forecast_refresh_events, "enqueue_best_effort", lambda request_id: None)
    return conn


# ---- create_promotion round trips --------------------------------------------


def test_create_with_many_stores_costs_a_fixed_number_of_statements(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    stores = [
        {"retailer": "fairprice", "store_name": f"Store {i}", "store_code": f"S{i:03}"}
        for i in range(40)
    ]

    result = promotion_service.create_promotion(_payload(stores=stores))

    assert result["promotion_id"] == 99
    # covered-store lookup, insert promotion, upsert retailers,
    # upsert stores, insert links, fetch. Never one per store.
    assert len(conn.calls) == 6


def test_store_links_are_inserted_from_one_array(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            stores=[
                {"retailer": "fairprice", "store_name": "A", "store_code": "A1"},
                {"retailer": "giant", "store_name": "B", "store_code": "B1"},
            ]
        )
    )

    [(sql, params)] = conn.sql_containing("INSERT INTO promotion_stores")
    assert "unnest" in sql
    assert params == {"promotion_id": 99, "store_ids": [10, 11]}


def test_each_retailer_name_is_sent_once(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            stores=[
                {"retailer": "fairprice", "store_name": "A", "store_code": "A1"},
                {"retailer": "fairprice", "store_name": "B", "store_code": "B1"},
            ]
        )
    )

    [(_, params)] = conn.sql_containing("INSERT INTO retailers")
    assert params == {"retailer_names": ["fairprice"]}


# ---- SKU resolution ----------------------------------------------------------


def test_ranges_resolve_to_catalog_skus_in_one_query(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            skus=[
                {"sku": "Pants", "sku_range": "Pants"},
                {"sku": "Tape", "sku_range": "Tape"},
            ]
        )
    )

    assert len(conn.sql_containing("sku_range = ANY")) == 1
    # Every range matched, so the exact-sku fallback is skipped.
    assert conn.sql_containing("sku = ANY") == []

    [(_, params)] = conn.sql_containing("INSERT INTO promotion_skus")
    assert params == {"promotion_id": 99, "skus": ["P-L", "P-M", "T-1"]}


def test_unmatched_range_falls_back_to_exact_sku(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(
        _payload(
            skus=[
                {"sku": "Pants", "sku_range": "Pants"},
                {"sku": "LOOSE-1", "sku_range": "Unknown"},
            ]
        )
    )

    [(_, params)] = conn.sql_containing("sku = ANY")
    assert params == {"skus": ["LOOSE-1"]}

    [(_, params)] = conn.sql_containing("INSERT INTO promotion_skus")
    assert params["skus"] == ["P-L", "P-M", "LOOSE-1"]


def test_no_matching_skus_raises(monkeypatch):
    _install_fake_engine(monkeypatch)

    with pytest.raises(ValueError, match="No catalog SKUs"):
        promotion_service.create_promotion(
            _payload(skus=[{"sku": "Nope", "sku_range": "Nope"}])
        )


# ---- forecast page promo list -----------------------------------------------


def test_list_forecast_promotions_filters_product_customer_and_overlap(monkeypatch):
    def respond(sql, params):
        assert "sk.product_name = :product_name" in sql
        assert ":customer_offline" in sql
        assert "p.period_end >= :start_date" in sql
        assert "p.period_start <= :end_date" in sql
        return [
            {
                "promotion_id": 7,
                "period_start": datetime.date(2026, 6, 3),
                "period_end": datetime.date(2026, 6, 9),
                "period_label": "Jun week 1",
                "promo_type": "carton_bundle",
                "promotion_mechanic": "Buy 2 Get 1 Free",
                "voucher": "B2G1",
                "skus": [
                    {
                        "sku": "13255044",
                        "sku_range": "Aire Adult Diaper Pants",
                        "product_name": "Aire Adult Pants S/M",
                    }
                ],
            }
        ]

    conn = FakeConnection(respond)
    monkeypatch.setattr(promotion_service, "_get_engine", lambda: FakeEngine(conn))

    rows = promotion_service.list_forecast_promotions(
        product_name="Aire Adult Pants S/M",
        customer_name="fairprice",
        start_date="2026-01-01",
        end_date="2026-12-31",
    )

    [(sql, params)] = conn.calls
    assert params == {
        "product_name": "Aire Adult Pants S/M",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "customer_name": "fairprice",
        "customer_offline": "fairprice_offline",
        "customer_online": "fairprice_online",
    }
    assert "json_agg" in sql
    assert rows == [
        {
            "promotion_id": 7,
            "period_start": "2026-06-03",
            "period_end": "2026-06-09",
            "period_label": "Jun week 1",
            "promo_type": "carton_bundle",
            "promotion_mechanic": "Buy 2 Get 1 Free",
            "voucher": "B2G1",
            "skus": [
                {
                    "sku": "13255044",
                    "sku_range": "Aire Adult Diaper Pants",
                    "product_name": "Aire Adult Pants S/M",
                }
            ],
        }
    ]


def test_list_forecast_promotions_matches_capitalised_customer_to_slug_retailers(monkeypatch):
    # The forecast page sends the customer as named (FairPrice); its
    # retailers are lowercase slugs, so a case-sensitive match found nothing.
    def respond(sql, params):
        assert "customer_retailers" in sql
        assert "LOWER(c.customer_name) = LOWER(:customer_name)" in sql
        return []

    conn = FakeConnection(respond)
    monkeypatch.setattr(promotion_service, "_get_engine", lambda: FakeEngine(conn))

    promotion_service.list_forecast_promotions(customer_name="FairPrice")

    [(_, params)] = conn.calls
    assert params == {
        "customer_name": "FairPrice",
        "customer_offline": "fairprice_offline",
        "customer_online": "fairprice_online",
    }


def test_list_forecast_promotions_skips_optional_filters(monkeypatch):
    def respond(sql, params):
        assert ":product_name" not in sql
        assert ":customer_offline" not in sql
        return []

    conn = FakeConnection(respond)
    monkeypatch.setattr(promotion_service, "_get_engine", lambda: FakeEngine(conn))

    assert promotion_service.list_forecast_promotions() == []
    [(_, params)] = conn.calls
    assert params == {}


def test_no_sku_items_skips_sku_queries(monkeypatch):
    conn = _install_fake_engine(monkeypatch)

    promotion_service.create_promotion(_payload())

    assert conn.sql_containing("FROM skus") == []
    assert conn.sql_containing("INSERT INTO promotion_skus") == []


# ---- duplicate events ----------------------------------------------------------


def _covering(*rows):
    """A fake where (retailer_name, store_code) rows already run the event."""
    return lambda sql, params: _respond(sql, params, covered=rows)


def test_create_skips_stores_already_running_the_event(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _covering(("FairPrice", " BM01 ")))

    result = promotion_service.create_promotion(
        _payload(
            stores=[
                {"retailer": "fairprice", "store_name": "Bedok", "store_code": "BM01"},
                {"retailer": "fairprice", "store_name": "Tampines", "store_code": "TM02"},
            ]
        )
    )

    [(_, params)] = conn.sql_containing("INSERT INTO stores")
    assert params["store_codes"] == ["TM02"]
    assert result["skipped_stores"] == [
        {"retailer": "fairprice", "store_name": "Bedok", "store_code": "BM01"},
    ]


def test_create_where_every_store_runs_the_event_raises_without_writing(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _covering(("fairprice", "BM01")))

    with pytest.raises(promotion_service.PromotionClashError, match="fairprice / Bedok"):
        promotion_service.create_promotion(_payload())

    assert conn.sql_containing("INSERT INTO") == []


def test_the_event_is_matched_on_dates_type_and_trimmed_mechanic(monkeypatch):
    conn = _install_fake_engine(monkeypatch)
    payload = _payload()
    payload.promotion_mechanic = "  10% off "

    promotion_service.create_promotion(payload)

    [(_, params)] = conn.sql_containing(_COVERED_STORES_SQL)
    assert params == {
        "period_start": payload.period_start,
        "period_end": payload.period_end,
        "promo_type": "monthly",
        "mechanic": "10% off",
        "exclude_id": None,
    }


def test_update_into_a_clash_raises_and_ignores_the_promotion_itself(monkeypatch):
    def respond(sql, params):
        if "SELECT 1 FROM promotions" in sql:
            return [(1,)]
        return _respond(sql, params, covered=[("fairprice", "BM01")])

    conn = _install_fake_engine(monkeypatch, respond)

    with pytest.raises(promotion_service.PromotionClashError):
        promotion_service.update_promotion(7, _payload())

    [(_, params)] = conn.sql_containing(_COVERED_STORES_SQL)
    assert params["exclude_id"] == 7
    assert conn.sql_containing("UPDATE promotions") == []


# ---- overview page -------------------------------------------------------------

TODAY = datetime.date(2026, 11, 11)


def _page_respond(total=3, unfiltered=5):
    def respond(sql, params):
        if "AS unfiltered_total" in sql:
            return [{"unfiltered_total": unfiltered, "total": total}]
        if "LIMIT :limit" in sql:
            return [{"promotion_id": 1, "stores": [], "skus": []}]
        return []
    return respond


def _page_query(conn):
    [(sql, params)] = conn.sql_containing("LIMIT :limit")
    return sql, params


def test_page_returns_its_rows_and_both_counts(monkeypatch):
    _install_fake_engine(monkeypatch, _page_respond(total=3, unfiltered=5))

    result = promotion_service.list_promotion_page(limit=25, today=TODAY)

    assert result == {
        "promotions": [{"promotion_id": 1, "stores": [], "skus": []}],
        "total": 3,
        "unfiltered_total": 5,
        "limit": 25,
        "offset": 0,
    }


def test_page_hides_older_copies_of_the_same_promotion(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(limit=25, today=TODAY)

    sql, _ = _page_query(conn)
    assert "copy_rank = 1" in sql
    assert "ORDER BY p.promotion_id DESC ) AS copy_rank" in sql


def test_offset_past_the_end_moves_back_to_the_last_page(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond(total=30))

    result = promotion_service.list_promotion_page(limit=25, offset=100, today=TODAY)

    assert result["offset"] == 25
    assert _page_query(conn)[1]["offset"] == 25


def test_sort_and_direction_order_the_page_with_newest_first_on_ties(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(limit=10, sort="period_end", direction="asc", today=TODAY)

    sql, params = _page_query(conn)
    assert "ORDER BY p.period_end ASC, p.promotion_id DESC" in sql
    assert params["limit"] == 10


def test_filters_are_bound_parameters(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(
        limit=25,
        retailer="fairprice_offline",
        store="Bedok",
        period="Nov 2026",
        promo_type="monthly",
        mechanic="10% off",
        today=TODAY,
    )

    sql, params = _page_query(conn)
    assert {key: params[key] for key in ("retailer", "store", "period", "promo_type", "mechanic")} == {
        "retailer": ["fairprice_offline"],
        "store": ["Bedok"],
        "period": ["Nov 2026"],
        "promo_type": ["monthly"],
        "mechanic": ["10% off"],
    }
    assert "r.retailer_name = ANY(CAST(:retailer AS text[]))" in sql
    assert "s.store_name = ANY(CAST(:store AS text[]))" in sql


def test_multi_select_filters_match_any_selected_value(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(
        limit=25,
        retailer=["fairprice_offline", "prime_offline"],
        status=["active", "upcoming"],
        today=TODAY,
    )

    sql, params = _page_query(conn)
    assert params["retailer"] == ["fairprice_offline", "prime_offline"]
    assert "r.retailer_name = ANY(CAST(:retailer AS text[]))" in sql
    assert " OR " in sql
    assert "CAST(:today AS date) < p.period_start" in sql


def test_status_filter_compares_dates_to_the_given_day(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(limit=25, status="upcoming", today=TODAY)

    sql, params = _page_query(conn)
    assert params["today"] == TODAY
    assert "CAST(:today AS date) < p.period_start" in sql


def test_each_search_word_must_match_and_wildcards_are_literal(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(limit=25, search="  FairPrice 50%  ", today=TODAY)

    sql, params = _page_query(conn)
    assert params["word_0"] == "%fairprice%"
    assert params["word_1"] == "%50\\%%"
    assert ":word_0" in sql and ":word_1" in sql


def test_search_matches_promo_type_and_status_labels(monkeypatch):
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(limit=25, search="offer upcoming", today=TODAY)

    sql, params = _page_query(conn)
    assert params["word_0_types"] == ["side_offer", "carton_side_offer"]
    assert "CAST(:today AS date) < p.period_start" in sql


@pytest.mark.parametrize("query", [{"sort": "voucher"}, {"direction": "up"}, {"status": "soon"}])
def test_invalid_query_raises_without_querying(monkeypatch, query):
    def _no_client_allowed():
        raise AssertionError("an invalid query must not reach the database")

    monkeypatch.setattr(promotion_service, "_get_engine", _no_client_allowed)

    with pytest.raises(ValueError):
        promotion_service.list_promotion_page(limit=25, **query)


def test_filter_options_come_from_every_listed_promotion(monkeypatch):
    def respond(sql, params):
        if "r.retailer_name AS value" in sql:
            return [("fairprice_offline",), ("giant_offline",)]
        if "p.period_label AS value" in sql:
            return [("Nov 2026",)]
        return []

    conn = _install_fake_engine(monkeypatch, respond)

    options = promotion_service.get_promotion_filter_options()

    assert options == {
        "retailers": ["fairprice_offline", "giant_offline"],
        "stores": [],
        "periods": ["Nov 2026"],
        "types": [],
        "mechanics": [],
    }
    assert all("copy_rank = 1" in sql for sql, _ in conn.calls)


def test_search_also_matches_the_customer_that_owns_the_retailer(monkeypatch):
    # sheng_siong_offline belongs to the customer Sheng_Shiong: "shiong" is
    # only in the customer's name.
    conn = _install_fake_engine(monkeypatch, _page_respond())

    promotion_service.list_promotion_page(limit=25, search="sheng shiong", today=TODAY)

    sql, params = _page_query(conn)
    assert params["word_1"] == "%shiong%"
    assert "cr.retailer_id = r.retailer_id" in sql
    assert "REPLACE(c.customer_name, '_', ' ') ILIKE :word_1" in sql
