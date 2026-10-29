from app.services import sql


class FakeCursor:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, statement):
        self._conn.events.append(("execute", statement))

    def close(self):
        self._conn.events.append(("close",))


class FakeDbapiConnection:
    """Records what is run on a raw pg8000 connection, in order."""

    def __init__(self):
        self.events = []

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.events.append(("commit",))


# ---- session timezone ---------------------------------------------------------

def test_new_connections_are_pinned_to_utc_and_committed():
    conn = FakeDbapiConnection()

    sql._use_utc(conn)

    # Committed, or the pool's rollback-on-return would undo the SET.
    assert conn.events == [("execute", "SET TIME ZONE 'UTC'"), ("close",), ("commit",)]


# ---- Credentials ----------------------------------------------------------------

class FakeConnector:
    """Records the arguments the Cloud SQL connector was built with."""

    def __init__(self, **kwargs):
        self.kwargs = kwargs


def _configure_database(monkeypatch, key_path):
    monkeypatch.setattr(sql.config, "GOOGLE_APPLICATION_CREDENTIALS", key_path)
    monkeypatch.setattr(sql.config, "POSTGRESQL_INSTANCE_CONNECTION_NAME", "aire-data:region:instance")
    monkeypatch.setattr(sql.config, "DB_IAM_USER", "aireos-api@aire-data.iam")
    monkeypatch.setattr(sql.config, "DB_NAME", "aireos")
    monkeypatch.setattr(sql, "Connector", FakeConnector)
    monkeypatch.setattr(sql, "_engine", None)
    monkeypatch.setattr(sql, "_connector", None)


def test_connector_uses_runtime_identity_without_key_file(monkeypatch):
    _configure_database(monkeypatch, None)

    sql.connect_with_connector()

    # None makes the connector fall back to Application Default Credentials.
    assert sql._connector.kwargs["credentials"] is None


def test_connector_uses_key_file_when_configured(monkeypatch, tmp_path):
    key = tmp_path / "gcp-key.json"
    key.write_text("{}")
    _configure_database(monkeypatch, str(key))
    loaded = []

    def _from_file(path, scopes):
        loaded.append(path)
        return "key-credentials"

    monkeypatch.setattr(sql.service_account.Credentials, "from_service_account_file", _from_file)

    sql.connect_with_connector()

    assert loaded == [str(key)]
    assert sql._connector.kwargs["credentials"] == "key-credentials"
