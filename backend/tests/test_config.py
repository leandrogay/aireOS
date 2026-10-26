import importlib
from unittest.mock import MagicMock

import pytest

from app import config


def test_backend_env_is_loaded_once_from_backend_root(monkeypatch):
    loader = MagicMock()
    monkeypatch.setattr(config, "load_dotenv", loader)
    config.load_backend_env.cache_clear()
    try:
        config.load_backend_env()
        config.load_backend_env()
        loader.assert_called_once_with(
            config.Path(config.__file__).resolve().parents[1] / ".env.backend"
        )
    finally:
        config.load_backend_env.cache_clear()


# ---- Blank settings ----

# .env.example leaves every optional setting blank, so a copied .env.backend sets
# them to "" -- which must mean "use the default", exactly like leaving them out.
DEFAULTED_SETTINGS = {
    "GCS_DESTINATION_PREFIX": "uploads/",
    "GCS_DESTINATION_PREFIX_MAPPING": "mappings/",
    "BQ_FAIRPRICESELLOUT_TABLE": "aire-data.Aire_Data.aireOS_fairprice",
    "BQ_FORECAST_OUTPUT_VIEW": "aire-data.Aire_Data_Analytics.aire_forecasting_output",
    "BQ_SALES_ENRICHED_VIEW": "aire-data.Aire_Data_Analytics.v_sales_enriched",
    "BQ_FORECAST_TABLE": "aire-data.Aire_Data.forecasting_output_xianhui_mock",
    "BQ_MONTHLY_SALES_VIEW": "aire-data.Aire_Data_Analytics.v_customer_monthly_sales",
    "BQ_TRAINING_RUN_LOG_TABLE": "aire-data.Aire_Data_Analytics.training_run_log",
    "BQ_FORECAST_PIPELINE_VIEW": "aire-data.Aire_Data_Analytics.aire_forecasting_output",
    "AUTH_ENABLED": "false",
    "AUTH_ALLOWED_DOMAIN": "shop-aire.com",
    "AUTH_FRONTEND_URL": "http://localhost:3000",
    "AUTH_COOKIE_SECURE": "false",
    "GOOGLE_OAUTH_REDIRECT_URI": "http://localhost:8000/api/auth/callback",
    "MAPPING_MODEL": "gemini-3.8-flash",
    "MAPPING_VERTEX_LOCATION": "global",
    "GEMINI_ASSISTANT_MODEL": "gemini-3.8-flash",
    "GCP_VERTEX_LOCATION": "global",
}


@pytest.mark.parametrize("name", sorted(DEFAULTED_SETTINGS))
def test_a_blank_setting_falls_back_to_its_default(monkeypatch, name):
    monkeypatch.setenv(name, "")
    reloaded = importlib.reload(config)
    try:
        assert getattr(reloaded, name) == DEFAULTED_SETTINGS[name]
    finally:
        monkeypatch.undo()
        importlib.reload(config)


# ---- Optional key files ----

def test_unset_key_file_means_runtime_identity(monkeypatch):
    monkeypatch.setattr(config, "SERVICE_ACCOUNT_KEY_PATH", None)

    assert config.optional_key_file("SERVICE_ACCOUNT_KEY_PATH") is None


def test_existing_key_file_is_returned(monkeypatch, tmp_path):
    key = tmp_path / "gcp-key.json"
    key.write_text("{}")
    monkeypatch.setattr(config, "SERVICE_ACCOUNT_KEY_PATH", str(key))

    assert config.optional_key_file("SERVICE_ACCOUNT_KEY_PATH") == str(key)


def test_missing_key_file_still_fails_loudly(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "SERVICE_ACCOUNT_KEY_PATH", str(tmp_path / "typo.json"))

    with pytest.raises(config.ConfigError, match="does not exist"):
        config.optional_key_file("SERVICE_ACCOUNT_KEY_PATH")
