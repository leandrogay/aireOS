"""
A slow forecast read finishes and returns its rows (no time limit), and the
rest of the API keeps answering while it runs -- what failed on 8 Nov 2026,
when the output view took 14+ minutes per query and "/" queued behind it.
"""

import asyncio
import time

import anyio.to_thread
import httpx
import pandas as pd

from app.main import app
from app.services import bigquery

SLOW_SECONDS = 0.5


class SlowJob:
    def result(self, timeout=None):
        time.sleep(SLOW_SECONDS)
        return self

    def to_dataframe(self, create_bqstorage_client=True):
        return pd.DataFrame(
            [{"product_name": "Pants L", "customer_name": "fairprice", "first_month": None, "last_month": None}]
        )


class SlowClient:
    def query(self, query, job_config=None):
        return SlowJob()


async def _get(client: httpx.AsyncClient, path: str, finished: dict):
    response = await client.get(path)
    finished[path] = time.monotonic()
    return response


def test_the_health_check_answers_while_a_slow_forecast_read_holds_every_worker_thread(monkeypatch):
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: SlowClient())

    async def scenario():
        # One worker thread, held by the slow forecast read.
        anyio.to_thread.current_default_thread_limiter().total_tokens = 1
        finished = {}
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            slow = asyncio.create_task(_get(client, "/api/forecast/options", finished))
            await asyncio.sleep(0.05)
            root = await _get(client, "/", finished)
            return await slow, root, finished

    slow, root, finished = asyncio.run(scenario())

    assert root.status_code == 200
    assert finished["/"] < finished["/api/forecast/options"]
    # The slow read is waited for, not given up on.
    assert slow.status_code == 200
    assert slow.json()["products"] == ["Pants L"]
