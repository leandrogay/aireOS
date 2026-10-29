from fastapi.testclient import TestClient

from app import config
from app.main import app


# ---- Origin parsing ----

def test_origins_are_split_trimmed_and_lose_trailing_slashes():
    raw = " https://aireos.example.com/ , http://localhost:3000,, "

    assert config.parse_origins(raw) == ["https://aireos.example.com", "http://localhost:3000"]


def test_empty_origin_list_parses_to_nothing():
    assert config.parse_origins("") == []


def test_default_origins_are_the_local_dev_server():
    assert config.parse_origins(config.DEFAULT_CORS_ALLOWED_ORIGINS) == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


# ---- Middleware ----

def test_listed_origin_gets_cors_headers():
    origin = config.CORS_ALLOWED_ORIGINS[0]
    response = TestClient(app).get("/", headers={"Origin": origin})

    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


def test_unlisted_origin_gets_no_cors_headers():
    response = TestClient(app).get("/", headers={"Origin": "https://evil.example"})

    assert "access-control-allow-origin" not in response.headers


def test_preflight_from_unlisted_origin_is_rejected():
    response = TestClient(app).options(
        "/api/promotions",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )

    assert response.status_code == 400
