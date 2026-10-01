from unittest.mock import MagicMock

from app.services import sql


def test_close_database_disposes_engines_and_connector(monkeypatch):
    write_engine = MagicMock()
    read_engine = MagicMock()
    connector = MagicMock()
    monkeypatch.setattr(sql, "_engine", write_engine)
    monkeypatch.setattr(sql, "_read_engine", read_engine)
    monkeypatch.setattr(sql, "_connector", connector)

    sql.close_database()

    write_engine.dispose.assert_called_once_with()
    read_engine.dispose.assert_called_once_with()
    connector.close.assert_called_once_with()
    assert sql._engine is None
    assert sql._read_engine is None
    assert sql._connector is None
