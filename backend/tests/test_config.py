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
