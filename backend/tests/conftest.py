"""
Shared fakes for the Cloud SQL services.

FakeConnection stands in for a SQLAlchemy Connection: it records
every statement and its bound parameters, and answers each one
from a caller-supplied `respond(sql, params)` function so a test
can assert on the contract (parameters, statement count) without
a database.

FrozenDatetime pins the clock for the UTC tests.
"""

import datetime


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


# ---- Clock ----------------------------------------------------------------

# 30 Sep 17:00 UTC is already 1 Oct 01:00 in Singapore, so the UTC day and
# the Singapore day differ: the case where a server-local clock gives itself away.
FROZEN_UTC = datetime.datetime(2026, 9, 30, 17, 0, tzinfo=datetime.timezone.utc)
SINGAPORE = datetime.timezone(datetime.timedelta(hours=8))


class FrozenDatetime(datetime.datetime):
    """datetime.datetime stuck at FROZEN_UTC, on a server whose local clock is Singapore time."""

    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return FROZEN_UTC.astimezone(SINGAPORE).replace(tzinfo=None)
        return FROZEN_UTC.astimezone(tz)
