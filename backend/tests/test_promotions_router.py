"""
Status codes for the promotion overview routes (routers/promotions.py):
the paged list, its filter options, and the 409 for a duplicate event.
The query building itself is tested in test_promotion_service.py.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.promotions import PromotionStoreRef
from app.services import promotion_service

client = TestClient(app)

PAGE = {"promotions": [], "total": 0, "unfiltered_total": 0, "limit": 10, "offset": 20}

BODY = {
    "stores": [{"retailer": "fairprice", "store_name": "Bedok", "store_code": "BM01"}],
    "period_start": "2026-01-01",
    "period_end": "2026-01-31",
    "promo_type": "monthly",
    "skus": [],
}


def _clash(*args, **kwargs):
    store = PromotionStoreRef(retailer="fairprice", store_name="Bedok", store_code="BM01")
    raise promotion_service.PromotionClashError([store])


# ---- GET /api/promotions ----

def test_list_passes_the_query_to_the_service(monkeypatch):
    calls = []
    monkeypatch.setattr(promotion_service, "list_promotion_page", lambda **query: calls.append(query) or PAGE)

    response = client.get(
        "/api/promotions",
        params={"limit": 10, "offset": 20, "search": "fp", "sort": "period_end", "direction": "asc", "status": "past"},
    )

    assert response.status_code == 200
    assert response.json() == PAGE
    assert calls[0]["limit"] == 10
    assert calls[0]["status"] == "past"
    assert calls[0]["retailer"] == ""


def test_list_maps_a_bad_sort_to_400(monkeypatch):
    def _bad(**query):
        raise ValueError("sort must be one of period_start, period_end")

    monkeypatch.setattr(promotion_service, "list_promotion_page", _bad)

    response = client.get("/api/promotions", params={"sort": "voucher"})

    assert response.status_code == 400
    assert "sort must be one of" in response.json()["detail"]


def test_list_rejects_a_limit_over_100_with_422():
    response = client.get("/api/promotions", params={"limit": 101})

    assert response.status_code == 422


def test_list_maps_a_database_failure_to_500(monkeypatch):
    def _down(**query):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(promotion_service, "list_promotion_page", _down)

    response = client.get("/api/promotions")

    assert response.status_code == 500
    assert response.json()["detail"].startswith("Failed to retrieve promotions")


# ---- GET /api/promotions/filter-options ----

def test_filter_options_route_is_not_taken_for_a_promotion_id(monkeypatch):
    options = {"retailers": ["fairprice_offline"], "stores": [], "periods": [], "types": [], "mechanics": []}
    monkeypatch.setattr(promotion_service, "get_promotion_filter_options", lambda: options)

    response = client.get("/api/promotions/filter-options")

    assert response.status_code == 200
    assert response.json() == options


# ---- duplicate events ----

def test_create_of_a_duplicate_event_is_409_naming_the_stores(monkeypatch):
    monkeypatch.setattr(promotion_service, "create_promotion", _clash)

    response = client.post("/api/promotions", json=BODY)

    assert response.status_code == 409
    assert response.json()["detail"] == "This combination already exists for fairprice / Bedok."


def test_update_into_a_duplicate_event_is_409(monkeypatch):
    monkeypatch.setattr(promotion_service, "update_promotion", _clash)

    response = client.put("/api/promotions/7", json=BODY)

    assert response.status_code == 409
