"""
Shared fakes for the Cloud SQL services.

FakeConnection stands in for a SQLAlchemy Connection: it records
every statement and its bound parameters, and answers each one
from a caller-supplied `respond(sql, params)` function so a test
can assert on the contract (parameters, statement count) without
a database.
"""


class FakeResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._rows[0][0] if self._rows else None

    def scalar_one(self):
        return self._rows[0][0]

    def scalars(self):
        return FakeResult([row[0] for row in self._rows])

    def mappings(self):
        return FakeResult([dict(row) for row in self._rows])


class FakeConnection:
    """Records (sql, params) calls; `respond` decides what each returns."""

    def __init__(self, respond=None):
        self.calls = []
        self._respond = respond or (lambda sql, params: [])

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        self.calls.append((sql, params))
        return FakeResult(self._respond(sql, params))

    def sql_containing(self, fragment):
        return [
            (sql, params)
            for sql, params in self.calls
            if fragment in sql
        ]


class FakeEngine:
    """Hands the same FakeConnection back from begin() and connect()."""

    def __init__(self, conn):
        self.conn = conn

    def begin(self):
        return self

    def connect(self):
        return self

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False
