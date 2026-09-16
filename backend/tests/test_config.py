from unittest.mock import MagicMock

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
