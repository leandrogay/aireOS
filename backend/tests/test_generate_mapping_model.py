import importlib

from app import config
from app.services import generate_mapping

# The mapping model's settings and client. What the model is asked, and how its
# answers are handled, is in test_generate_mapping.py.


# ---- Client setup ----

def test_client_is_built_on_vertex_with_the_configured_location(monkeypatch):
    built = {}

    def _fake_client(**kwargs):
        built.update(kwargs)
        return "client"

    monkeypatch.setattr(generate_mapping, "_gemini_client", None)
    monkeypatch.setattr(config, "GCP_PROJECT_ID", "aire-data")
    monkeypatch.setattr(generate_mapping.genai, "Client", _fake_client)

    try:
        assert generate_mapping.get_gemini_client() == "client"
    finally:
        monkeypatch.setattr(generate_mapping, "_gemini_client", None)

    assert built == {
        "enterprise": True,
        "project": "aire-data",
        "location": config.MAPPING_VERTEX_LOCATION,
    }


# ---- Settings ----

def test_blank_model_settings_fall_back_to_defaults(monkeypatch):
    monkeypatch.setenv("MAPPING_MODEL", "")
    monkeypatch.setenv("MAPPING_VERTEX_LOCATION", "")
    reloaded = importlib.reload(config)
    try:
        assert reloaded.MAPPING_MODEL == "gemini-3.8-flash"
        assert reloaded.MAPPING_VERTEX_LOCATION == "global"
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_blank_assistant_settings_fall_back_to_defaults(monkeypatch):
    # .env.example ships these blank, so a copied .env.backend sets them to "".
    monkeypatch.setenv("GEMINI_ASSISTANT_MODEL", "")
    monkeypatch.setenv("GCP_VERTEX_LOCATION", "")
    reloaded = importlib.reload(config)
    try:
        assert reloaded.GEMINI_ASSISTANT_MODEL == "gemini-3.8-flash"
        assert reloaded.GCP_VERTEX_LOCATION == "global"
    finally:
        monkeypatch.undo()
        importlib.reload(config)
