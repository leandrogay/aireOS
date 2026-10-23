import threading

from app import main
from app.services import notification_service


class _StopAfter(threading.Event):
    """An Event whose wait() reports "stopped" after `rounds` waits, without sleeping."""

    def __init__(self, rounds):
        super().__init__()
        self.rounds = rounds
        self.waited_for = []

    def wait(self, timeout=None):
        self.waited_for.append(timeout)
        self.rounds -= 1
        return self.rounds <= 0


def test_the_cleanup_runs_at_once_and_then_once_per_interval(monkeypatch):
    calls = []
    monkeypatch.setattr(notification_service, "delete_expired", lambda: calls.append(1) or 0)
    stop = _StopAfter(rounds=3)

    main._cleanup_loop(stop, interval_seconds=86400)

    assert len(calls) == 3
    assert stop.waited_for == [86400, 86400, 86400]


def test_a_failed_cleanup_does_not_end_the_loop(monkeypatch):
    calls = []

    def failing():
        calls.append(1)
        raise RuntimeError("database is down")

    monkeypatch.setattr(notification_service, "delete_expired", failing)

    main._cleanup_loop(_StopAfter(rounds=2), interval_seconds=60)

    assert len(calls) == 2
