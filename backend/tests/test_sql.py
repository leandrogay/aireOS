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
