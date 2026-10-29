import pytest

from app.services import storage as storage_service


class FakeStorageClient:
    """Records how the GCS client was built."""

    def __init__(self, project=None, credentials=None):
        self.project = project
        self.credentials = credentials


@pytest.fixture(autouse=True)
def _fresh_client(monkeypatch):
    monkeypatch.setattr(storage_service.storage, "Client", FakeStorageClient)
    monkeypatch.setattr(storage_service.config, "GCP_PROJECT_ID", "aire-data")
    storage_service.get_storage_client.cache_clear()
    yield
    storage_service.get_storage_client.cache_clear()


# ---- Credentials ----

def test_client_uses_runtime_identity_without_key_file(monkeypatch):
    monkeypatch.setattr(storage_service.config, "SERVICE_ACCOUNT_KEY_PATH", None)

    client = storage_service.get_storage_client()

    assert client.project == "aire-data"
    assert client.credentials is None


def test_client_uses_key_file_when_configured(monkeypatch, tmp_path):
    key = tmp_path / "gcp-key.json"
    key.write_text("{}")
    monkeypatch.setattr(storage_service.config, "SERVICE_ACCOUNT_KEY_PATH", str(key))
    monkeypatch.setattr(
        storage_service.service_account.Credentials,
        "from_service_account_file",
        lambda path: f"credentials from {path}",
    )

    client = storage_service.get_storage_client()

    assert client.credentials == f"credentials from {key}"


def test_missing_key_file_is_a_config_error(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_service.config, "SERVICE_ACCOUNT_KEY_PATH", str(tmp_path / "typo.json"))

    with pytest.raises(storage_service.GCSConfigError, match="does not exist"):
        storage_service.get_storage_client()
