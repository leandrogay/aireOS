import json

import pytest

from app import config
from app.services import generate_mapping


class FakeResponse:
    def __init__(self, text):
        self.text = text


class FakeModels:
    """Records the generate_content call and returns a canned reply."""

    def __init__(self, text):
        self._text = text
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return FakeResponse(self._text)


class FakeGeminiClient:
    def __init__(self, text):
        self.models = FakeModels(text)


def _install_client(monkeypatch, text):
    client = FakeGeminiClient(text)
    monkeypatch.setattr(generate_mapping, "get_client", lambda: client)
    return client.models


_CONTRACT = {
    "identity_mapping": {"Store": "store_name", "Article": "sku"},
    "melt_groups": [],
    "annotations": {},
    "transformations": {},
}
_COLUMNS = ["Store", "Article"]
_TARGETS = ["store_name", "sku"]


# ---- Asking the model ----

def test_contract_comes_from_the_models_json_reply(monkeypatch):
    models = _install_client(monkeypatch, json.dumps(_CONTRACT))

    contract = generate_mapping.generate_mapping_contract(_COLUMNS, _TARGETS)

    assert contract["identity_mapping"] == {"Store": "store_name", "Article": "sku"}
    assert len(models.calls) == 1


def test_request_asks_for_json_from_the_configured_model(monkeypatch):
    models = _install_client(monkeypatch, json.dumps(_CONTRACT))

    generate_mapping.generate_mapping_contract(_COLUMNS, _TARGETS)

    call = models.calls[0]
    assert call["model"] == config.MAPPING_MODEL
    assert call["config"].response_mime_type == "application/json"
    assert "Raw source columns" in call["contents"]


def test_markdown_fences_around_the_reply_are_tolerated(monkeypatch):
    _install_client(monkeypatch, "```json\n" + json.dumps(_CONTRACT) + "\n```")

    contract = generate_mapping.generate_mapping_contract(_COLUMNS, _TARGETS)

    assert contract["identity_mapping"]["Article"] == "sku"


# ---- Bad replies ----

def test_non_json_reply_is_a_generation_error(monkeypatch):
    _install_client(monkeypatch, "Sorry, I cannot help with that.")

    with pytest.raises(generate_mapping.MappingGenerationError):
        generate_mapping.generate_mapping_contract(_COLUMNS, _TARGETS)


def test_blocked_reply_with_no_text_is_a_generation_error(monkeypatch):
    _install_client(monkeypatch, None)

    with pytest.raises(generate_mapping.MappingGenerationError):
        generate_mapping.generate_mapping_contract(_COLUMNS, _TARGETS)


# ---- Client setup ----

def test_client_needs_a_project_and_no_api_key(monkeypatch):
    monkeypatch.setattr(generate_mapping, "_client", None)
    monkeypatch.setattr(config, "GCP_PROJECT_ID", None)

    with pytest.raises(generate_mapping.MappingConfigError, match="GCP_PROJECT_ID"):
        generate_mapping.get_client()


def test_client_is_built_on_vertex_with_the_configured_location(monkeypatch):
    built = {}

    def _fake_client(**kwargs):
        built.update(kwargs)
        return "client"

    monkeypatch.setattr(generate_mapping, "_client", None)
    monkeypatch.setattr(config, "GCP_PROJECT_ID", "aire-data")
    monkeypatch.setattr(generate_mapping.genai, "Client", _fake_client)

    try:
        assert generate_mapping.get_client() == "client"
    finally:
        monkeypatch.setattr(generate_mapping, "_client", None)

    assert built == {
        "enterprise": True,
        "project": "aire-data",
        "location": config.MAPPING_VERTEX_LOCATION,
    }


def test_blank_model_settings_fall_back_to_defaults(monkeypatch):
    import importlib

    monkeypatch.setenv("MAPPING_MODEL", "")
    monkeypatch.setenv("MAPPING_VERTEX_LOCATION", "")
    reloaded = importlib.reload(config)
    try:
        assert reloaded.MAPPING_MODEL == "gemini-3.8-flash"
        assert reloaded.MAPPING_VERTEX_LOCATION == "global"
    finally:
        monkeypatch.undo()
        importlib.reload(config)
