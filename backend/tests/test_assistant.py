import json
import base64
import datetime

import pandas as pd
import pytest

from app.services import assistant, bigquery, promotion_service


# ---- Fakes mirroring just the SDK response shape assistant.py reads --------

class FakeFunctionCall:
    def __init__(self, id, name, args):
        self.id = id
        self.name = name
        self.args = args


class FakeCandidate:
    def __init__(self, content, finish_reason="STOP"):
        self.content = content
        self.finish_reason = finish_reason


class FakeResponse:
    """content is a plain dict placeholder for candidate.content -- ask()
    only appends it to `contents` for history, it never parses it back out
    (function calls come from the separate `function_calls` property, text
    from the separate `text` property, matching the real SDK)."""

    def __init__(self, function_calls=None, text=None, finish_reason="STOP", content=None):
        self.function_calls = function_calls or []
        self.text = text
        self.candidates = [FakeCandidate(content or {"role": "model", "parts": []}, finish_reason)]


class FakeModels:
    """Returns each queued response in order, one per call to .generate_content()."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def generate_content(self, **kwargs):
        # Snapshot contents -- assistant.ask() mutates the same list object
        # across loop iterations, so without a copy every recorded call
        # would end up pointing at the final, fully-mutated list.
        snapshot = {**kwargs, "contents": list(kwargs["contents"])}
        self.calls.append(snapshot)
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses):
        self.models = FakeModels(responses)


def _install_fake_client(monkeypatch, responses):
    fake_client = FakeClient(responses)
    monkeypatch.setattr(assistant, "get_client", lambda: fake_client)
    return fake_client


def _final_answer(
    text="Revenue was $1,000 last week.",
    grounded=True,
    data_source="aire_data",
    follow_ups=None,
    export_format="none",
    chart_style=None,
):
    payload = {
        "answer": text,
        "grounded": grounded,
        "data_source": data_source,
        "follow_up_prompts": follow_ups or ["Break this down by store?", "Compare to last month?"],
        "export_format": export_format,
        "chart_style": chart_style or dict(assistant._DEFAULT_CHART_STYLE),
    }
    return FakeResponse(
        text=json.dumps(payload),
        content={"role": "model", "parts": [{"text": json.dumps(payload)}]},
    )


def _tool_call_response(*calls):
    """calls: (id, name, args) tuples -- one FakeFunctionCall per call."""
    function_calls = [FakeFunctionCall(id, name, args) for id, name, args in calls]
    placeholder_parts = [{"function_call": {"id": id, "name": name, "args": args}} for id, name, args in calls]
    return FakeResponse(function_calls=function_calls, content={"role": "model", "parts": placeholder_parts})


def _dump(content):
    """Same logic as assistant._serialize_contents for one item -- real
    types.Content objects (built by ask() itself for tool-result turns) need
    .model_dump() to inspect; plain dicts (from our fakes) pass through."""
    return content.model_dump(exclude_none=True, mode="json") if hasattr(content, "model_dump") else content


# ---- ask(): tool loop shape -------------------------------------------------

def test_end_turn_immediately_with_no_tool_calls(monkeypatch):
    # grounded=False from the business-tools pass triggers the search
    # fallback (see the dedicated search-fallback tests below) -- here that
    # also comes back ungrounded, so the original answer wins.
    _install_fake_client(
        monkeypatch,
        [
            _final_answer(grounded=False, data_source="none", text="I don't have data for that."),
            _search_answer("Nothing relevant turned up."),
            _final_answer(grounded=False, data_source="none", text="Search didn't find anything either."),
        ],
    )

    result = assistant.ask("What's the meaning of life?", history=None, customer="fairprice")

    assert result["grounded"] is False
    assert result["data_source"] == "none"
    assert result["has_chart"] is False
    assert result["has_table"] is False


def test_first_request_sends_question_as_user_message(monkeypatch):
    fake_client = _install_fake_client(monkeypatch, [_final_answer()])

    assistant.ask("How did we do last week?", history=None, customer="fairprice")

    first_call = fake_client.models.calls[0]
    assert first_call["contents"][-1] == {"role": "user", "parts": [{"text": "How did we do last week?"}]}


def test_prior_history_is_carried_forward(monkeypatch):
    fake_client = _install_fake_client(monkeypatch, [_final_answer()])
    history = [
        {"role": "user", "parts": [{"text": "hi"}]},
        {"role": "model", "parts": [{"text": "hello"}]},
    ]

    assistant.ask("follow up question", history=history, customer="fairprice")

    first_call = fake_client.models.calls[0]
    assert first_call["contents"][0] == history[0]
    assert first_call["contents"][1] == history[1]


def test_returned_messages_can_be_replayed_next_turn(monkeypatch):
    _install_fake_client(monkeypatch, [_final_answer()])

    result = assistant.ask("How did we do last week?", history=None, customer="fairprice")

    # messages ends with the model's final turn appended (Gemini's role for
    # the model's own turns is "model", not Anthropic's "assistant")
    assert result["messages"][-1]["role"] == "model"


# ---- ask(): function_call -> function_response round trip ------------------

def test_tool_call_result_is_fed_back_and_chart_is_built(monkeypatch):
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    fake_client = _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    result = assistant.ask("How is revenue trending?", history=None, customer="fairprice")

    assert result["has_chart"] is True
    assert result["chart_categories"] == ["Week 1", "Week 2"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [1000.0, 1500.0]}]

    # the second generate_content() call carries the function result back
    second_call_contents = fake_client.models.calls[1]["contents"]
    tool_result_message = _dump(second_call_contents[-1])
    assert tool_result_message["role"] == "user"
    function_response = tool_result_message["parts"][0]["function_response"]
    assert function_response["name"] == "get_sales_summary"
    assert "result" in function_response["response"]


def test_get_sales_summary_chart_combines_offline_and_online(monkeypatch):
    # Regression: when the model answers from get_sales_summary alone
    # (skipping compare_periods), a headline like "$25,915 vs $23,703" is
    # the ALL-CHANNEL total -- the chart must sum offline+online per
    # period, not show just one channel.
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "May 2026", "period_start": "2026-05-01", "revenue": 15430.44, "units": 1561},
                {"period_label": "June 2026", "period_start": "2026-06-01", "revenue": 16601.92, "units": 1735},
            ],
            "periodByFormat": [],
        },
        "online": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "May 2026", "period_start": "2026-05-01", "revenue": 8272.36, "units": 880},
                {"period_label": "June 2026", "period_start": "2026-06-01", "revenue": 9313.36, "units": 1007},
            ],
            "periodByFormat": [],
        },
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="June was up on May: $25,915.28 vs $23,702.80.")])

    result = assistant.ask("compare May to June", history=None, customer="fairprice")

    assert result["chart_categories"] == ["May 2026", "June 2026"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [23702.80, 25915.28]}]


def test_tool_error_is_reported_as_is_error_and_loop_continues(monkeypatch):
    def _boom(**kwargs):
        raise ValueError("granularity must be one of ('week', 'month')")

    monkeypatch.setattr(bigquery, "get_dashboard_summary", _boom)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "decade"}))
    fake_client = _install_fake_client(
        monkeypatch,
        [
            tool_call,
            _final_answer(grounded=False, data_source="none"),
            _search_answer("Nothing relevant turned up."),
            _final_answer(grounded=False, data_source="none"),
        ],
    )

    result = assistant.ask("bad question", history=None, customer="fairprice")

    second_call_contents = fake_client.models.calls[1]["contents"]
    function_response = _dump(second_call_contents[-1])["parts"][0]["function_response"]["response"]
    assert "error" in function_response
    assert "Invalid arguments" in function_response["error"]
    # a failed tool call never becomes a chart
    assert result["has_chart"] is False


def test_multiple_tool_use_blocks_in_one_turn_all_get_results(monkeypatch):
    monkeypatch.setattr(bigquery, "get_customer_options", lambda: [{"value": "fairprice", "label": "Fairprice"}])
    monkeypatch.setattr(bigquery, "get_store_options", lambda customer: [{"store_code": "S1", "store_name": "Store 1"}])

    tool_call = _tool_call_response(
        ("tu_1", "list_customers", {}),
        ("tu_2", "list_stores", {"customer": "fairprice"}),
    )
    fake_client = _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    assistant.ask("what stores do we have", history=None, customer="fairprice")

    tool_results = _dump(fake_client.models.calls[1]["contents"][-1])["parts"]
    names = {p["function_response"]["name"] for p in tool_results}
    assert names == {"list_customers", "list_stores"}


def test_get_sales_summary_mode_scoped_call_does_not_combine_channels(monkeypatch):
    # Regression (found via live testing): asked "offline sales in August",
    # the model correctly called get_sales_summary(mode="offline") and cited
    # the offline-only total ($5,473.15) -- but get_dashboard_summary always
    # computes BOTH channels regardless of what was asked, so the chart
    # (built by summing whatever channels are present in the raw result)
    # showed offline+online combined ($9,632.45), silently contradicting
    # the answer's own channel-scoped figure. _run_business_tool must strip
    # the non-requested channel before it ever reaches chart-building.
    full_summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-06", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-06", "revenue": 4159.30, "units": 300}], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: full_summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="Fairprice's offline sales in August 2026 were $5,473.15.")])

    result = assistant.ask("what was sales for fairprice offline in august 2026", history=None, customer="fairprice")

    assert result["chart_categories"] == ["August 2026"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [5473.15]}]


def test_get_sales_summary_no_mode_still_combines_channels(monkeypatch):
    # The combining behaviour itself is correct and still needed when no
    # mode was specified (e.g. "total revenue across both channels").
    full_summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-06", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-06", "revenue": 4159.30, "units": 300}], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: full_summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="Total sales in August 2026 were $9,632.45.")])

    result = assistant.ask("what was total sales in august 2026", history=None, customer="fairprice")

    assert result["chart_series"] == [{"label": "Revenue", "values": [9632.45]}]


def test_default_customer_used_when_tool_omits_it(monkeypatch):
    captured = {}

    def _fake_options(customer):
        captured["customer"] = customer
        return []

    monkeypatch.setattr(bigquery, "get_store_options", _fake_options)

    tool_call = _tool_call_response(("tu_1", "list_stores", {}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    assistant.ask("stores?", history=None, customer="fairprice")

    assert captured["customer"] == "fairprice"


# ---- ask(): compare_periods / rank_skus chart shaping -----------------------

def test_compare_periods_builds_two_bar_chart(monkeypatch):
    comparison = {
        "current": {"start": "2026-08-17", "end": "2026-08-23", "revenue": 1200.0, "units": 60},
        "previous": {"start": "2026-08-10", "end": "2026-08-16", "revenue": 900.0, "units": 45, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: comparison)

    tool_call = _tool_call_response(("tu_1", "compare_periods", {"comparison_type": "wow"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    result = assistant.ask("how does this week compare", history=None, customer="fairprice")

    assert result["chart_categories"] == ["Previous", "Current"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [900.0, 1200.0]}]


def test_compare_periods_mode_scoped_calls_are_summed_to_a_combined_total(monkeypatch):
    # Regression: the model sometimes calls compare_periods once per
    # channel (mode="offline", mode="online") instead of once unscoped, to
    # narrate a per-channel breakdown -- with no unscoped call, whichever
    # scoped call happened to run last would show only that channel's
    # numbers under a combined-total headline. The two scoped calls must
    # be summed back into the same combined total instead.
    results = {
        "online": {
            "current": {"start": "2026-06-01", "end": "2026-06-30", "revenue": 9313.36, "units": 1007},
            "previous": {"start": "2026-05-01", "end": "2026-05-31", "revenue": 8272.36, "units": 880, "available": True},
        },
        "offline": {
            "current": {"start": "2026-06-01", "end": "2026-06-30", "revenue": 16601.92, "units": 1735},
            "previous": {"start": "2026-05-01", "end": "2026-05-31", "revenue": 15430.44, "units": 1561, "available": True},
        },
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: results[kwargs["mode"]])

    # Confirmed live: the real model passes explicit previous_start/
    # previous_end for a genuine comparison (not just current_start/end) --
    # that's also the signal _build_chart uses to tell "real comparison"
    # apart from "compare_periods used as a plain range-total calculator".
    tool_call = _tool_call_response(
        ("tu_1", "compare_periods", {"current_start": "2026-06-01", "current_end": "2026-06-30", "previous_start": "2026-05-01", "previous_end": "2026-05-31", "mode": "online"}),
        ("tu_2", "compare_periods", {"current_start": "2026-06-01", "current_end": "2026-06-30", "previous_start": "2026-05-01", "previous_end": "2026-05-31", "mode": "offline"}),
    )
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="June was up on May: $25,915.28 vs $23,702.80.")])

    result = assistant.ask("compare May to June by channel", history=None, customer="fairprice")

    assert result["chart_categories"] == ["Previous", "Current"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [23702.80, 25915.28]}]


def test_compare_periods_prefers_unscoped_call_over_mode_scoped_ones(monkeypatch):
    # Whenever an unscoped (combined) call exists, it's already the
    # all-channel total -- use it directly rather than trying to sum the
    # scoped calls too (which, called alongside it, would double-count).
    unscoped = {
        "current": {"start": "2026-06-01", "end": "2026-06-30", "revenue": 25915.28, "units": 2742},
        "previous": {"start": "2026-05-01", "end": "2026-05-31", "revenue": 23702.80, "units": 2441, "available": True},
    }
    offline_only = {
        "current": {"start": "2026-06-01", "end": "2026-06-30", "revenue": 16601.92, "units": 1735},
        "previous": {"start": "2026-05-01", "end": "2026-05-31", "revenue": 15430.44, "units": 1561, "available": True},
    }
    results = iter([unscoped, offline_only])
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: next(results))

    tool_call = _tool_call_response(
        ("tu_1", "compare_periods", {"current_start": "2026-06-01", "current_end": "2026-06-30", "previous_start": "2026-05-01", "previous_end": "2026-05-31"}),
        ("tu_2", "compare_periods", {"current_start": "2026-06-01", "current_end": "2026-06-30", "previous_start": "2026-05-01", "previous_end": "2026-05-31", "mode": "offline"}),
    )
    _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    result = assistant.ask("compare May to June", history=None, customer="fairprice")

    assert result["chart_series"] == [{"label": "Revenue", "values": [23702.80, 25915.28]}]


def test_compare_periods_single_mode_scoped_call_used_as_is(monkeypatch):
    # A genuinely channel-specific question ("how did offline do vs last
    # week") only ever produces one scoped call -- there's nothing to sum
    # it with, so it's used directly.
    offline_only = {
        "current": {"start": "2026-08-17", "end": "2026-08-23", "revenue": 500.0, "units": 20},
        "previous": {"start": "2026-08-10", "end": "2026-08-16", "revenue": 400.0, "units": 15, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: offline_only)

    tool_call = _tool_call_response(("tu_1", "compare_periods", {"comparison_type": "wow", "mode": "offline"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    result = assistant.ask("how did offline do this week", history=None, customer="fairprice")

    assert result["chart_series"] == [{"label": "Revenue", "values": [400.0, 500.0]}]


def test_compare_periods_used_as_short_range_total_shows_single_bar(monkeypatch):
    # Regression (found via live testing): asked for a plain total across a
    # date range, the model correctly used compare_periods as a SQL-summed
    # total calculator (current_start/end only, no comparison_type, no
    # explicit previous_start/end -- exactly the tool description's
    # guidance to avoid hand-adding get_sales_summary rows) -- but the
    # chart still showed an auto-derived "Previous" bar the question never
    # asked about. Without a real comparison request, a short (<=31 day)
    # range shows just the one figure that was actually asked for.
    range_total = {
        "current": {"start": "2026-07-01", "end": "2026-07-19", "revenue": 12000.0, "units": 1200},
        "previous": {"start": "2026-06-01", "end": "2026-06-19", "revenue": 11000.0, "units": 1100, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: range_total)

    tool_call = _tool_call_response(
        ("tu_1", "compare_periods", {"current_start": "2026-07-01", "current_end": "2026-07-19", "mode": "offline"})
    )
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="Fairprice's offline sales from Jul 1 to Jul 19, 2026 were $12,000.")])

    result = assistant.ask("what was fairprice offline sales from 1 jul 2026 until 19 july 2026", history=None, customer="fairprice")

    assert result["chart_categories"] == ["2026-07-01 to 2026-07-19"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [12000.0]}]


def test_compare_periods_used_as_multi_month_range_total_shows_monthly_breakdown(monkeypatch):
    # Regression (found via live testing): a multi-month range total (e.g.
    # "offline sales from Jan to Jul") showed one flat bar spanning the
    # whole range -- far less useful than a monthly trend. A range over a
    # month long now fetches a fresh monthly breakdown server-side (not via
    # another model tool call, so scope can't drift between two calls).
    range_total = {
        "current": {"start": "2026-01-01", "end": "2026-07-31", "revenue": 123860.85, "units": 12000},
        "previous": {"start": "2025-12-01", "end": "2025-12-31", "revenue": 20000.0, "units": 1800, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: range_total)

    monthly_summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "January 2026", "period_start": "2026-01-01", "revenue": 18496.44, "units": 1711},
                {"period_label": "February 2026", "period_start": "2026-02-05", "revenue": 16041.01, "units": 1466},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    captured_kwargs = {}

    def _fake_dashboard_summary(**kwargs):
        captured_kwargs.update(kwargs)
        return monthly_summary

    monkeypatch.setattr(bigquery, "get_dashboard_summary", _fake_dashboard_summary)

    tool_call = _tool_call_response(
        ("tu_1", "compare_periods", {"current_start": "2026-01-01", "current_end": "2026-07-31", "mode": "offline"})
    )
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="Fairprice's offline sales from Jan 1 to Jul 31, 2026 were $123,860.85.")])

    result = assistant.ask("what was fairprice offline sales from 1 jan 2026 until 31 july 2026", history=None, customer="fairprice")

    assert result["chart_categories"] == ["January 2026", "February 2026"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [18496.44, 16041.01]}]
    # the breakdown fetch reused the exact same scope compare_periods used
    assert captured_kwargs["customer"] == "fairprice"
    assert captured_kwargs["start_date"] == "2026-01-01"
    assert captured_kwargs["end_date"] == "2026-07-31"
    assert captured_kwargs["granularity"] == "month"


def test_multi_month_range_total_falls_back_to_single_bar_if_breakdown_fetch_fails(monkeypatch):
    range_total = {
        "current": {"start": "2026-01-01", "end": "2026-07-31", "revenue": 123860.85, "units": 12000},
        "previous": {"start": "2025-12-01", "end": "2025-12-31", "revenue": 20000.0, "units": 1800, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: range_total)

    def _boom(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(bigquery, "get_dashboard_summary", _boom)

    tool_call = _tool_call_response(
        ("tu_1", "compare_periods", {"current_start": "2026-01-01", "current_end": "2026-07-31", "mode": "offline"})
    )
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="Fairprice's offline sales from Jan 1 to Jul 31, 2026 were $123,860.85.")])

    result = assistant.ask("what was fairprice offline sales from 1 jan 2026 until 31 july 2026", history=None, customer="fairprice")

    assert result["chart_categories"] == ["2026-01-01 to 2026-07-31"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [123860.85]}]


def test_compare_periods_with_no_data_yields_empty_chart(monkeypatch):
    empty = {
        "current": {"start": None, "end": None, "revenue": 0.0, "units": 0.0},
        "previous": {"start": None, "end": None, "revenue": 0.0, "units": 0.0, "available": False},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: empty)

    tool_call = _tool_call_response(("tu_1", "compare_periods", {"comparison_type": "wow"}))
    _install_fake_client(
        monkeypatch,
        [
            tool_call,
            _final_answer(grounded=False, data_source="none"),
            _search_answer("Nothing relevant turned up."),
            _final_answer(grounded=False, data_source="none"),
        ],
    )

    result = assistant.ask("how does this week compare", history=None, customer="fairprice")

    assert result["has_chart"] is False


def test_multiple_sales_summary_calls_merge_into_one_comparison_chart(monkeypatch):
    # Regression: answering "compare May vs June" needs a per-format
    # breakdown for each month, which get_sales_summary only gives one
    # month at a time -- so the model calls it twice. The chart must show
    # both months, not just whichever call happened last.
    may = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "May 2026", "period_start": "2026-05-01", "revenue": 23702.80, "units": 2441}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    june = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "June 2026", "period_start": "2026-06-01", "revenue": 25915.28, "units": 2742}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    results = iter([may, june])
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: next(results))

    tool_call = _tool_call_response(
        ("tu_1", "get_sales_summary", {"granularity": "month", "start_date": "2026-05-01", "end_date": "2026-05-31"}),
        ("tu_2", "get_sales_summary", {"granularity": "month", "start_date": "2026-06-01", "end_date": "2026-06-30"}),
    )
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="June beat May.")])

    result = assistant.ask("compare May 2026 to June 2026", history=None, customer="fairprice")

    assert result["has_chart"] is True
    assert result["chart_categories"] == ["May 2026", "June 2026"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [23702.80, 25915.28]}]


def test_sequential_sales_summary_calls_across_turns_also_merge(monkeypatch):
    # Same as above but the two calls happen in separate turns (one tool
    # call per turn) rather than both in one model message.
    may = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "May 2026", "period_start": "2026-05-01", "revenue": 100.0, "units": 1}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    june = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "June 2026", "period_start": "2026-06-01", "revenue": 200.0, "units": 2}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    results = iter([may, june])
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: next(results))

    first_call = _tool_call_response(("tu_1", "get_sales_summary", {"start_date": "2026-05-01", "end_date": "2026-05-31"}))
    second_call = _tool_call_response(("tu_2", "get_sales_summary", {"start_date": "2026-06-01", "end_date": "2026-06-30"}))
    _install_fake_client(monkeypatch, [first_call, second_call, _final_answer()])

    result = assistant.ask("compare May to June", history=None, customer="fairprice")

    assert result["chart_categories"] == ["May 2026", "June 2026"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [100.0, 200.0]}]


def test_compare_periods_wins_over_get_sales_summary_when_both_called(monkeypatch):
    # Regression: the model often calls both tools to answer a comparison
    # question -- compare_periods for the headline total, get_sales_summary
    # for a per-format breakdown in the narrative. The chart must reflect
    # compare_periods' ALL-CHANNEL total (what the answer actually cites),
    # not get_sales_summary's per-channel split, regardless of call order.
    comparison = {
        "current": {"start": "2026-06-01", "end": "2026-06-30", "revenue": 25915.28, "units": 2742},
        "previous": {"start": "2026-05-01", "end": "2026-05-31", "revenue": 23702.80, "units": 2441, "available": True},
    }
    offline_only_summary = {
        "offline": {"storeFormats": [], "periodTotal": [
            {"period_label": "May 2026", "period_start": "2026-05-01", "revenue": 15430.44, "units": 1561},
            {"period_label": "June 2026", "period_start": "2026-06-01", "revenue": 16601.92, "units": 1735},
        ], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: comparison)
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: offline_only_summary)

    # get_sales_summary called SECOND (i.e. it would "win" under a
    # last-call-wins rule) -- compare_periods must still be preferred.
    tool_call = _tool_call_response(
        ("tu_1", "compare_periods", {"current_start": "2026-06-01", "current_end": "2026-06-30", "previous_start": "2026-05-01", "previous_end": "2026-05-31"}),
        ("tu_2", "get_sales_summary", {"start_date": "2026-05-01", "end_date": "2026-06-30"}),
    )
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="June beat May: $25,915.28 vs $23,702.80.")])

    result = assistant.ask("compare May to June", history=None, customer="fairprice")

    assert result["chart_categories"] == ["Previous", "Current"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [23702.80, 25915.28]}]


def test_rank_skus_builds_table_not_chart(monkeypatch):
    df = pd.DataFrame(
        [
            {"sku": "A", "product_name": "Widget", "volume": 10, "value": 100.0, "rank": 1},
            {"sku": "B", "product_name": "Gadget", "volume": 5, "value": 50.0, "rank": 2},
        ]
    )
    monkeypatch.setattr(bigquery, "get_sku_ranking", lambda **kwargs: df)

    tool_call = _tool_call_response(("tu_1", "rank_skus", {"metric": "value"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    result = assistant.ask("best sellers?", history=None, customer="fairprice")

    assert result["has_chart"] is False
    assert result["has_table"] is True
    assert result["table_columns"] == ["rank", "product_name", "volume", "value"]
    assert result["table_rows"][0] == ["1", "Widget", "10", "100.0"]


# ---- ask(): search fallback --------------------------------------------------
#
# Confirmed live against the real API, two separate constraints: (1) Gemini
# rejects mixing function-declaration tools with search tools in one
# request, and (2) structured output ("controlled generation") can't be
# combined with the search tool either. So a search fallback is genuinely
# three calls in the worst case: business tools (schema, no search) ->
# search (plain text, no schema) -> reshape (schema, no tools) -- the
# fixtures below model that with a plain-text fake for the search step.

def _search_answer(text):
    """The search-tool call returns plain text, not the JSON schema --
    unlike _final_answer(), which represents a schema-constrained call."""
    return FakeResponse(text=text, content={"role": "model", "parts": [{"text": text}]})


def test_search_fallback_used_when_business_tools_cannot_answer(monkeypatch):
    business_attempt = _final_answer(grounded=False, data_source="none", text="I don't have that in our sales data.")
    search_attempt = _search_answer("Industry-wide, apparel sales grew 4% this quarter.")
    reshaped = _final_answer(grounded=True, data_source="market_data", text="Industry-wide, apparel sales grew 4% this quarter.")
    fake_client = _install_fake_client(monkeypatch, [business_attempt, search_attempt, reshaped])

    result = assistant.ask("how is the broader apparel market doing?", history=None, customer="fairprice")

    assert result["grounded"] is True
    assert result["data_source"] == "market_data"
    assert "apparel sales grew" in result["answer"]
    # 1st call: business tools + schema. 2nd: search tool, no schema.
    # 3rd: no tools, schema only (reshaping the search text).
    assert fake_client.models.calls[0]["config"].tools == assistant._BUSINESS_TOOLS
    assert fake_client.models.calls[0]["config"].response_json_schema is not None
    assert fake_client.models.calls[1]["config"].tools == assistant._SEARCH_TOOLS
    assert fake_client.models.calls[1]["config"].response_json_schema is None
    assert fake_client.models.calls[2]["config"].tools is None
    assert fake_client.models.calls[2]["config"].response_json_schema is not None


def test_search_fallback_not_attempted_when_business_tools_succeed(monkeypatch):
    fake_client = _install_fake_client(monkeypatch, [_final_answer(grounded=True)])

    assistant.ask("how did we do last week?", history=None, customer="fairprice")

    assert len(fake_client.models.calls) == 1


def test_search_fallback_also_ungrounded_keeps_original_answer(monkeypatch):
    business_attempt = _final_answer(grounded=False, data_source="none", text="No internal data for that.")
    search_attempt = _search_answer("Nothing relevant turned up.")
    reshaped = _final_answer(grounded=False, data_source="none", text="Search didn't find anything either.")
    _install_fake_client(monkeypatch, [business_attempt, search_attempt, reshaped])

    result = assistant.ask("something genuinely unanswerable", history=None, customer="fairprice")

    assert result["grounded"] is False
    assert result["answer"] == "No internal data for that."


def test_search_fallback_refusal_keeps_original_ungrounded_answer(monkeypatch):
    business_attempt = _final_answer(grounded=False, data_source="none", text="No internal data for that.")
    search_refusal = FakeResponse(finish_reason="SAFETY", content={"role": "model", "parts": []})
    _install_fake_client(monkeypatch, [business_attempt, search_refusal])

    result = assistant.ask("something disallowed to search for", history=None, customer="fairprice")

    assert result["grounded"] is False
    assert result["answer"] == "No internal data for that."


def test_search_fallback_reshape_refusal_keeps_original_ungrounded_answer(monkeypatch):
    # The search step itself succeeds, but the follow-up reshape-into-JSON
    # call is refused -- still falls back to the original answer rather
    # than crashing on an unparseable/absent .text.
    business_attempt = _final_answer(grounded=False, data_source="none", text="No internal data for that.")
    search_attempt = _search_answer("Some search result text.")
    reshape_refusal = FakeResponse(finish_reason="SAFETY", content={"role": "model", "parts": []})
    _install_fake_client(monkeypatch, [business_attempt, search_attempt, reshape_refusal])

    result = assistant.ask("something searchable but unshapeable", history=None, customer="fairprice")

    assert result["grounded"] is False
    assert result["answer"] == "No internal data for that."


# ---- ask(): numeric grounding safeguard --------------------------------------
#
# Belt-and-suspenders on top of chart-building: the chart can never be
# wrong (built purely from tool data), but the model can occasionally slip
# on the headline dollar figure in the *text* even with every input number
# correct (observed live, unreproducible). These check that a mismatched
# headline triggers exactly one correction retry, and that retry is only
# trusted if it verifies too.

def test_mismatched_headline_figure_triggers_correction_retry(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    wrong_answer = _final_answer(text="Fairprice's offline sales in August 2026 were $5,123.45.")
    corrected_answer = _final_answer(text="Fairprice's offline sales in August 2026 were $5,473.15.")
    fake_client = _install_fake_client(monkeypatch, [tool_call, wrong_answer, corrected_answer])

    result = assistant.ask("what were offline sales in august", history=None, customer="fairprice")

    assert result["answer"] == "Fairprice's offline sales in August 2026 were $5,473.15."
    assert len(fake_client.models.calls) == 3  # tool call, wrong answer, correction retry
    correction_message = fake_client.models.calls[2]["contents"][-1]
    assert "5,123.45" in correction_message["parts"][0]["text"]
    assert "5,473.15" in correction_message["parts"][0]["text"]


def test_matching_headline_figure_does_not_trigger_retry(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    fake_client = _install_fake_client(
        monkeypatch, [tool_call, _final_answer(text="Fairprice's offline sales in August 2026 were $5,473.15.")]
    )

    assistant.ask("what were offline sales in august", history=None, customer="fairprice")

    assert len(fake_client.models.calls) == 2  # no correction retry


def test_correction_retry_still_wrong_keeps_original_answer(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    wrong_answer = _final_answer(text="Offline sales in August 2026 were $5,123.45.")
    still_wrong_answer = _final_answer(text="Offline sales in August 2026 were $5,200.00.")
    _install_fake_client(monkeypatch, [tool_call, wrong_answer, still_wrong_answer])

    result = assistant.ask("what were offline sales in august", history=None, customer="fairprice")

    # the retry didn't verify either -- keep the original rather than trust
    # a second unverified guess just because it's the most recent one
    assert result["answer"] == "Offline sales in August 2026 were $5,123.45."


def test_market_data_answers_are_not_checked_against_tool_figures(monkeypatch):
    business_attempt = _final_answer(grounded=False, data_source="none", text="No internal data for that.")
    search_attempt = _search_answer("Competitor launched a $999.00 product.")
    reshaped = _final_answer(grounded=True, data_source="market_data", text="A competitor launched a $999.00 product.")
    fake_client = _install_fake_client(monkeypatch, [business_attempt, search_attempt, reshaped])

    result = assistant.ask("any competitor news?", history=None, customer="fairprice")

    assert result["answer"] == "A competitor launched a $999.00 product."
    assert len(fake_client.models.calls) == 3  # no extra correction-retry call


def test_analysis_answers_are_not_checked_against_tool_figures(monkeypatch):
    # data_source="analysis" (reasons/suggestions, not a data lookup) is
    # intentionally ungrounded -- any figure it mentions in its own
    # reasoning shouldn't trigger the numeric-verification safeguard, which
    # only makes sense for aire_data answers claiming to be tool-verified.
    fake_client = _install_fake_client(
        monkeypatch,
        [_final_answer(grounded=False, data_source="analysis", text="Revenue likely dropped due to fewer promotions -- consider running one in $500 increments.")],
    )

    result = assistant.ask("why did revenue drop and what should we do?", history=None, customer="fairprice")

    assert result["data_source"] == "analysis"
    assert len(fake_client.models.calls) == 1  # no correction retry attempted


def test_answer_with_no_dollar_figure_is_not_checked(monkeypatch):
    tool_call = _tool_call_response(("tu_1", "list_customers", {}))
    monkeypatch.setattr(bigquery, "get_customer_options", lambda: [{"value": "fairprice", "label": "Fairprice"}])
    fake_client = _install_fake_client(
        monkeypatch, [tool_call, _final_answer(text="We currently have data for Fairprice.")]
    )

    result = assistant.ask("which customers do we have?", history=None, customer="fairprice")

    assert result["answer"] == "We currently have data for Fairprice."
    assert len(fake_client.models.calls) == 2  # no correction retry attempted


def test_correction_retry_refusal_keeps_original_answer(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    wrong_answer = _final_answer(text="Offline sales in August 2026 were $5,123.45.")
    retry_refusal = FakeResponse(finish_reason="SAFETY", content={"role": "model", "parts": []})
    _install_fake_client(monkeypatch, [tool_call, wrong_answer, retry_refusal])

    result = assistant.ask("what were offline sales in august", history=None, customer="fairprice")

    assert result["answer"] == "Offline sales in August 2026 were $5,123.45."


# ---- ask(): PDF/PPTX export --------------------------------------------------
#
# File bytes are built entirely from the already-correct `chart` dict, never
# round-tripped through the model -- same reasoning as chart/table numbers
# never being. These check the dispatch/degradation logic; byte-level
# PDF/PPTX correctness was spot-checked manually (SimpleDocTemplate/
# Presentation round-trips verified directly against the installed
# reportlab/python-pptx before writing the production code).

def test_export_format_none_produces_no_download(monkeypatch):
    _install_fake_client(monkeypatch, [_final_answer(export_format="none")])

    result = assistant.ask("how did we do last week?", history=None, customer="fairprice")

    assert result["has_download"] is False
    assert result["download_filename"] is None
    assert result["download_base64"] is None


def test_export_pdf_with_chart_produces_real_pdf_bytes(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(text="Offline sales in August 2026 were $5,473.15.", export_format="pdf")],
    )

    result = assistant.ask("export this as pdf", history=None, customer="fairprice")

    assert result["has_download"] is True
    assert result["download_filename"] == "aireos-report.pdf"
    assert result["download_mime_type"] == "application/pdf"
    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_pptx_with_chart_produces_real_pptx_bytes(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(text="Offline sales in August 2026 were $5,473.15.", export_format="pptx")],
    )

    result = assistant.ask("make me a slide for this", history=None, customer="fairprice")

    assert result["has_download"] is True
    assert result["download_filename"] == "aireos-report.pptx"
    assert result["download_mime_type"] == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:2] == b"PK"  # pptx is a zip archive


def test_export_excel_with_chart_produces_real_xlsx_bytes(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(text="Offline sales in August 2026 were $5,473.15.", export_format="excel")],
    )

    result = assistant.ask("export this as excel", history=None, customer="fairprice")

    assert result["has_download"] is True
    assert result["download_filename"] == "aireos-report.xlsx"
    assert result["download_mime_type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:2] == b"PK"  # xlsx is a zip archive


def test_export_with_table_instead_of_chart_still_produces_a_file(monkeypatch):
    df = pd.DataFrame([{"sku": "A", "product_name": "Widget", "volume": 10, "value": 100.0, "rank": 1}])
    monkeypatch.setattr(bigquery, "get_sku_ranking", lambda **kwargs: df)

    tool_call = _tool_call_response(("tu_1", "rank_skus", {"metric": "value"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="Widget is the top seller.", export_format="pdf")])

    result = assistant.ask("export our best sellers as pdf", history=None, customer="fairprice")

    assert result["has_download"] is True
    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_with_no_chart_or_table_still_produces_text_only_file(monkeypatch):
    # A bare "export this as PDF" with nothing fetched this turn -- degrades
    # to a text-only file rather than failing, per the plan's resolution for
    # when the model doesn't re-fetch data on an export follow-up.
    _install_fake_client(monkeypatch, [_final_answer(text="We currently have data for Fairprice.", export_format="pdf")])

    result = assistant.ask("export that as pdf", history=None, customer="fairprice")

    assert result["has_download"] is True
    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_split_into_points_requires_at_least_two_bullets():
    assert assistant._split_into_points("Just one plain sentence.") is None
    assert assistant._split_into_points("- Only one bullet") is None
    assert assistant._split_into_points("- First point\n- Second point\n- Third point") == [
        "First point", "Second point", "Third point",
    ]
    assert assistant._split_into_points("Some intro text\n- Point A\n- Point B") == ["Point A", "Point B"]


def test_export_pptx_renders_multiple_insights_as_bulleted_paragraphs(monkeypatch):
    from pptx import Presentation
    import io as _io

    analysis_text = (
        "- Revenue dipped in Week 21, coinciding with Widget A's volume dropping 40%.\n"
        "- The recovery in Week 22 lines up with restocking of Widget A.\n"
        "- Offline sales consistently outpaced online across all four weeks."
    )
    _install_fake_client(
        monkeypatch,
        [_final_answer(text=analysis_text, grounded=False, data_source="analysis", export_format="pptx")],
    )

    result = assistant.ask("give me insights on possible reasons for the recent sales trend", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    title_slide = prs.slides[0]
    body_paragraphs = [p.text for p in title_slide.placeholders[1].text_frame.paragraphs]
    assert body_paragraphs == [
        "Revenue dipped in Week 21, coinciding with Widget A's volume dropping 40%.",
        "The recovery in Week 22 lines up with restocking of Widget A.",
        "Offline sales consistently outpaced online across all four weeks.",
    ]


def test_export_pptx_shrinks_font_and_enables_autofit_for_long_bullets(monkeypatch):
    # Regression for the overflow bug: PowerPoint's default 28pt placeholder
    # font overflowed the slide with just 3-4 full-sentence bullets (seen
    # live, screenshot showed text cut off past the slide edge).
    from pptx import Presentation
    from pptx.enum.text import MSO_AUTO_SIZE
    import io as _io

    analysis_text = (
        "- Sales peaked in April, potentially due to successful promotional campaigns or strong seasonal demand.\n"
        "- A notable dip occurred in May, which could be a natural follow-up after an active promotional period.\n"
        "- The significant decline in August is likely influenced by the Singapore National Day public holiday."
    )
    _install_fake_client(
        monkeypatch,
        [_final_answer(text=analysis_text, grounded=False, data_source="analysis", export_format="pptx")],
    )

    result = assistant.ask("give me insights on the sales trend", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    tf = prs.slides[0].placeholders[1].text_frame
    assert tf.auto_size == MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    for paragraph in tf.paragraphs:
        assert paragraph.font.size.pt <= 18  # well under the 28pt default that overflowed


def test_export_pptx_splits_many_bullets_across_multiple_slides(monkeypatch):
    from pptx import Presentation
    import io as _io

    analysis_text = "\n".join(f"- Insight number {i}, a genuinely distinct data-backed point." for i in range(1, 7))
    _install_fake_client(
        monkeypatch,
        [_final_answer(text=analysis_text, grounded=False, data_source="analysis", export_format="pptx")],
    )

    result = assistant.ask("give me insights on the sales trend", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    # 6 bullets, capped at 4/slide -> 2 insight slides, then the chart slide
    assert prs.slides[0].shapes.title.text == "AireOS Report (1/2)"
    assert prs.slides[1].shapes.title.text == "AireOS Report (2/2)"
    slide0_bullets = [p.text for p in prs.slides[0].placeholders[1].text_frame.paragraphs]
    slide1_bullets = [p.text for p in prs.slides[1].placeholders[1].text_frame.paragraphs]
    assert len(slide0_bullets) == 4
    assert len(slide1_bullets) == 2
    assert slide0_bullets + slide1_bullets == [f"Insight number {i}, a genuinely distinct data-backed point." for i in range(1, 7)]


def test_export_pptx_single_sentence_answer_still_uses_plain_title_slide(monkeypatch):
    from pptx import Presentation
    import io as _io

    _install_fake_client(
        monkeypatch,
        [_final_answer(text="Revenue was $1,000 last week.", export_format="pptx")],
    )

    result = assistant.ask("how did we do last week?", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    assert prs.slides[0].placeholders[1].text == "Revenue was $1,000 last week."


def test_export_pdf_renders_multiple_insights_as_bullets(monkeypatch):
    analysis_text = "- First data-backed insight.\n- Second data-backed insight."
    _install_fake_client(
        monkeypatch,
        [_final_answer(text=analysis_text, grounded=False, data_source="analysis", export_format="pdf")],
    )

    result = assistant.ask("give me insights on the sales trend", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_generation_failure_degrades_to_no_download(monkeypatch):
    monkeypatch.setattr(assistant, "_build_pdf", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    _install_fake_client(monkeypatch, [_final_answer(export_format="pdf")])

    result = assistant.ask("export this as pdf", history=None, customer="fairprice")

    assert result["has_download"] is False
    assert result["answer"] == "Revenue was $1,000 last week."  # the core answer still comes through


# ---- ask(): refusal / loop-limit --------------------------------------------

def test_refusal_returns_safe_fallback_instead_of_parsing_content(monkeypatch):
    blocked = FakeResponse(finish_reason="SAFETY", content={"role": "model", "parts": []})
    _install_fake_client(monkeypatch, [blocked])

    result = assistant.ask("something disallowed", history=None, customer="fairprice")

    assert result["grounded"] is False
    assert result["data_source"] == "none"
    assert result["has_chart"] is False


def test_loop_raises_after_max_iterations_of_tool_use(monkeypatch):
    tool_call = _tool_call_response(("tu_1", "list_customers", {}))
    monkeypatch.setattr(bigquery, "get_customer_options", lambda: [])
    responses = [tool_call] * (assistant.MAX_TOOL_ITERATIONS + 1)
    _install_fake_client(monkeypatch, responses)

    with pytest.raises(assistant.AssistantLoopError):
        assistant.ask("infinite loop question", history=None, customer="fairprice")


# ---- get_client() config error ----------------------------------------------

def test_get_client_raises_when_gcp_project_missing(monkeypatch):
    monkeypatch.setattr(assistant, "_client", None)
    monkeypatch.setattr(assistant, "GCP_PROJECT_ID", None)

    with pytest.raises(assistant.AssistantConfigError):
        assistant.get_client()


# ---- chart_style: pure helpers ----------------------------------------------

def test_sanitize_color_accepts_default_and_valid_hex():
    assert assistant._sanitize_color("default") == "default"
    assert assistant._sanitize_color("#DC2626") == "#DC2626"


def test_sanitize_color_rejects_invalid_values():
    assert assistant._sanitize_color("red") == "default"
    assert assistant._sanitize_color("#GGGGGG") == "default"
    assert assistant._sanitize_color(None) == "default"
    assert assistant._sanitize_color("") == "default"


def test_linear_trend_on_perfectly_linear_series():
    assert assistant._linear_trend([10.0, 20.0, 30.0]) == [10.0, 20.0, 30.0]


def test_linear_trend_fits_two_points_exactly():
    assert assistant._linear_trend([1000.0, 1500.0]) == [1000.0, 1500.0]


def test_linear_trend_returns_empty_for_fewer_than_two_points():
    assert assistant._linear_trend([]) == []
    assert assistant._linear_trend([100.0]) == []


def test_resolve_last_chart_falls_back_when_no_new_chart_data():
    last_chart = {
        "has_chart": True, "chart_type": "bar", "chart_categories": ["May"],
        "chart_series": [{"label": "Revenue", "values": [500.0]}],
        "has_table": False, "table_columns": [], "table_rows": [],
    }
    assert assistant._resolve_last_chart(assistant._empty_chart(), last_chart) == last_chart


def test_resolve_last_chart_prefers_fresh_data_over_stale():
    fresh_chart = {
        "has_chart": True, "chart_type": "bar", "chart_categories": ["June"],
        "chart_series": [{"label": "Revenue", "values": [700.0]}],
        "has_table": False, "table_columns": [], "table_rows": [],
    }
    stale_chart = {**fresh_chart, "chart_categories": ["May"]}
    assert assistant._resolve_last_chart(fresh_chart, stale_chart) == fresh_chart


def test_resolve_last_chart_stays_empty_when_neither_has_data():
    assert assistant._resolve_last_chart(assistant._empty_chart(), None) == assistant._empty_chart()
    assert assistant._resolve_last_chart(assistant._empty_chart(), {}) == assistant._empty_chart()


def test_system_prompt_states_the_current_chart_style():
    style = {**assistant._DEFAULT_CHART_STYLE, "color": "#DC2626", "show_value_labels": True}
    prompt = assistant._system_prompt(style)
    assert "color=#DC2626" in prompt
    assert "show_value_labels=True" in prompt
    assert "show_trend_line=False" in prompt
    assert "value_label_format=auto" in prompt
    assert "show_gridlines=True" in prompt
    assert "chart_type=auto" in prompt


def test_sanitize_chart_style_falls_back_to_defaults_for_bad_enums():
    result = assistant._sanitize_chart_style({
        "color": "not-a-color",
        "show_value_labels": "yes",
        "value_label_format": "scientific-notation",
        "show_trend_line": 1,
        "show_gridlines": "nope",
        "chart_type": "pie",
    })
    assert result["color"] == "default"
    assert result["show_value_labels"] is True
    assert result["value_label_format"] == "auto"
    assert result["show_trend_line"] is True
    assert result["show_gridlines"] is True
    assert result["chart_type"] == "auto"


def test_sanitize_chart_style_handles_missing_input():
    assert assistant._sanitize_chart_style(None) == assistant._DEFAULT_CHART_STYLE
    assert assistant._sanitize_chart_style({}) == assistant._DEFAULT_CHART_STYLE


def test_sanitize_chart_style_title_is_trimmed_and_length_capped():
    assert assistant._sanitize_chart_style({"title": "  Past 4 Months  "})["title"] == "Past 4 Months"
    assert assistant._sanitize_chart_style({"title": None})["title"] == ""
    long_title = "x" * 200
    assert len(assistant._sanitize_chart_style({"title": long_title})["title"]) == assistant._MAX_CHART_TITLE_LENGTH


def test_sanitize_chart_style_new_fields_valid_input():
    result = assistant._sanitize_chart_style({
        "show_legend": True,
        "y_axis_label": "  Revenue ($)  ",
        "opacity": 0.6,
        "corner_radius": 8,
        "font_size": "large",
        "show_data_points": True,
    })
    assert result["show_legend"] is True
    assert result["y_axis_label"] == "Revenue ($)"
    assert result["opacity"] == 0.6
    assert result["corner_radius"] == 8
    assert result["font_size"] == "large"
    assert result["show_data_points"] is True


def test_sanitize_chart_style_new_fields_adversarial_input():
    result = assistant._sanitize_chart_style({
        "show_legend": "yes",
        "y_axis_label": "x" * 200,
        "opacity": 5.0,  # way over the 1.0 max
        "corner_radius": -10,  # under the 0 min
        "font_size": "gigantic",
        "show_data_points": 1,
    })
    assert result["show_legend"] is True
    assert len(result["y_axis_label"]) == assistant._MAX_AXIS_LABEL_LENGTH
    assert result["opacity"] == 1.0
    assert result["corner_radius"] == 0
    assert result["font_size"] == "medium"
    assert result["show_data_points"] is True

    result2 = assistant._sanitize_chart_style({"opacity": "not-a-number", "corner_radius": "also-not-a-number"})
    assert result2["opacity"] == 1.0
    assert result2["corner_radius"] == 4


def test_resolve_chart_type_overrides_when_requested_and_different():
    chart = {"has_chart": True, "chart_type": "bar", "chart_categories": ["a"], "chart_series": []}
    result = assistant._resolve_chart_type(chart, {"chart_type": "line"})
    assert result["chart_type"] == "line"
    assert result["chart_categories"] == ["a"]  # untouched


def test_resolve_chart_type_leaves_auto_untouched():
    chart = {"has_chart": True, "chart_type": "bar", "chart_categories": ["a"], "chart_series": []}
    assert assistant._resolve_chart_type(chart, {"chart_type": "auto"}) == chart


def test_resolve_chart_type_does_nothing_without_a_chart():
    empty = assistant._empty_chart()
    assert assistant._resolve_chart_type(empty, {"chart_type": "line"}) == empty


# ---- chart_style: ask() round trip ------------------------------------------

def test_chart_style_defaults_when_model_omits_customization(monkeypatch):
    _install_fake_client(monkeypatch, [_final_answer()])

    result = assistant.ask("how did we do last week?", history=None, customer="fairprice")

    assert result["chart_style"] == assistant._DEFAULT_CHART_STYLE
    assert result["chart_trend_values"] == []


def test_chart_style_invalid_color_from_model_is_sanitized(monkeypatch):
    _install_fake_client(
        monkeypatch,
        [_final_answer(chart_style={"color": "mauve", "show_value_labels": False, "show_trend_line": False})],
    )

    result = assistant.ask("make it mauve", history=None, customer="fairprice")

    assert result["chart_style"]["color"] == "default"


def test_chart_style_valid_hex_color_passes_through(monkeypatch):
    _install_fake_client(
        monkeypatch,
        [_final_answer(chart_style={"color": "#DC2626", "show_value_labels": False, "show_trend_line": False})],
    )

    result = assistant.ask("make the bars red", history=None, customer="fairprice")

    assert result["chart_style"]["color"] == "#DC2626"


def test_trend_line_is_computed_from_the_charted_values(monkeypatch):
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(chart_style={"color": "default", "show_value_labels": False, "show_trend_line": True})],
    )

    result = assistant.ask("add a trend line", history=None, customer="fairprice")

    assert result["chart_style"]["show_trend_line"] is True
    assert result["chart_trend_values"] == [1000.0, 1500.0]


def test_no_trend_line_values_when_not_requested(monkeypatch):
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [{"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10}],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    result = assistant.ask("how did we do last week?", history=None, customer="fairprice")

    assert result["chart_trend_values"] == []


def test_last_chart_carried_forward_when_no_tool_call_this_turn(monkeypatch):
    # A pure styling follow-up ("make it red") makes no tool call -- the
    # chart the frontend already has on screen must still come back, not an
    # empty one, or there'd be nothing left to style.
    last_chart = {
        "has_chart": True, "chart_type": "bar", "chart_categories": ["May 2026"],
        "chart_series": [{"label": "Revenue", "values": [5473.15]}],
        "has_table": False, "table_columns": [], "table_rows": [],
    }
    _install_fake_client(
        monkeypatch,
        [_final_answer(chart_style={"color": "#DC2626", "show_value_labels": False, "show_trend_line": False})],
    )

    result = assistant.ask("make it red", history=None, customer="fairprice", last_chart=last_chart)

    assert result["has_chart"] is True
    assert result["chart_categories"] == ["May 2026"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [5473.15]}]
    assert result["chart_style"]["color"] == "#DC2626"


def test_last_chart_not_carried_forward_for_an_off_topic_refusal(monkeypatch):
    # Regression (found via live testing): "what should I eat for lunch"
    # also makes no tool call, same as a styling follow-up -- but unlike
    # "make it red", it has nothing to do with the previous chart, so
    # carrying it forward showed a misleading graph under an answer that
    # was actually just a refusal.
    last_chart = {
        "has_chart": True, "chart_type": "bar", "chart_categories": ["May 2026"],
        "chart_series": [{"label": "Revenue", "values": [5473.15]}],
        "has_table": False, "table_columns": [], "table_rows": [],
    }
    _install_fake_client(
        monkeypatch,
        [_final_answer(
            text="I can't help with that -- I can only answer questions about AireOS's sales data.",
            grounded=True,
            data_source="none",
        )],
    )

    result = assistant.ask("what should i eat for lunch", history=None, customer="fairprice", last_chart=last_chart)

    assert result["has_chart"] is False
    assert result["chart_categories"] == []


def test_last_chart_style_seeds_the_system_prompt(monkeypatch):
    fake_client = _install_fake_client(monkeypatch, [_final_answer()])

    assistant.ask(
        "add a trend line",
        history=None,
        customer="fairprice",
        last_chart_style={"color": "#DC2626", "show_value_labels": False, "show_trend_line": False},
    )

    first_call = fake_client.models.calls[0]
    assert "color=#DC2626" in first_call["config"].system_instruction


# ---- chart_style: export builders -------------------------------------------

def test_export_pptx_reflects_custom_color_and_value_labels(monkeypatch):
    from pptx import Presentation
    import io as _io

    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [
            tool_call,
            _final_answer(
                text="Offline sales in August 2026 were $5,473.15.",
                export_format="pptx",
                chart_style={"color": "#DC2626", "show_value_labels": True, "show_trend_line": False},
            ),
        ],
    )

    result = assistant.ask("export this as pptx in red with value labels", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    chart_slide = prs.slides[1]
    chart = next(shape.chart for shape in chart_slide.shapes if shape.has_chart)
    assert str(chart.series[0].format.fill.fore_color.rgb) == "DC2626"
    assert chart.plots[0].has_data_labels is True


def test_export_pptx_reflects_value_format_and_gridlines(monkeypatch):
    from pptx import Presentation
    import io as _io

    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [
            tool_call,
            _final_answer(
                export_format="pptx",
                chart_style={
                    **assistant._DEFAULT_CHART_STYLE,
                    "show_value_labels": True,
                    "value_label_format": "whole_number",
                    "show_gridlines": False,
                },
            ),
        ],
    )

    result = assistant.ask("export as pptx with whole numbers and no gridlines", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    chart = next(shape.chart for shape in prs.slides[1].shapes if shape.has_chart)
    assert chart.plots[0].data_labels.number_format == "0"
    assert chart.value_axis.has_major_gridlines is False


def test_export_pptx_with_line_chart_type(monkeypatch):
    from pptx import Presentation
    from pptx.enum.chart import XL_CHART_TYPE
    import io as _io

    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(export_format="pptx", chart_style={**assistant._DEFAULT_CHART_STYLE, "chart_type": "line", "color": "#DC2626"})],
    )

    result = assistant.ask("show this as a line chart and export as pptx", history=None, customer="fairprice")

    assert result["chart_type"] == "line"
    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    chart = next(shape.chart for shape in prs.slides[1].shapes if shape.has_chart)
    assert chart.chart_type == XL_CHART_TYPE.LINE
    assert str(chart.series[0].format.line.color.rgb) == "DC2626"


def test_chart_data_is_never_affected_by_adversarial_chart_style(monkeypatch):
    # The concrete guarantee behind "strictly from BigQuery": however wild
    # chart_style gets, chart_categories/chart_series must come out exactly
    # as _build_chart produced them -- proven here across a battery of
    # malformed/adversarial style payloads, not just the happy path.
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    adversarial_styles = [
        {"color": "javascript:alert(1)", "chart_type": "pie", "value_label_format": "$$$hack$$$"},
        {"color": "#DC2626; DROP TABLE sales;", "show_value_labels": "definitely", "chart_type": "scatter3d"},
        {"chart_type": "line", "value_label_format": "whole_number", "show_gridlines": "not-a-bool"},
        {"title": "x" * 500},
        {"opacity": -99, "corner_radius": "banana", "font_size": "gigantic", "y_axis_label": "x" * 999, "show_legend": "maybe"},
        {},  # nothing at all
    ]

    for style in adversarial_styles:
        tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
        _install_fake_client(monkeypatch, [tool_call, _final_answer(chart_style=style)])

        result = assistant.ask("how is revenue trending?", history=None, customer="fairprice")

        assert result["chart_categories"] == ["Week 1", "Week 2"]
        assert result["chart_series"] == [{"label": "Revenue", "values": [1000.0, 1500.0]}]


def test_export_pdf_with_custom_color_still_produces_valid_pdf(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [
            tool_call,
            _final_answer(
                text="Offline sales in August 2026 were $5,473.15.",
                export_format="pdf",
                chart_style={"color": "#DC2626", "show_value_labels": True, "show_trend_line": False},
            ),
        ],
    )

    result = assistant.ask("export this as pdf in red", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_pptx_reflects_custom_chart_title(monkeypatch):
    from pptx import Presentation
    import io as _io

    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(export_format="pptx", chart_style={**assistant._DEFAULT_CHART_STYLE, "title": "Past 4 Months"})],
    )

    result = assistant.ask("add a title called Past 4 Months and export as pptx", history=None, customer="fairprice")

    assert result["chart_style"]["title"] == "Past 4 Months"
    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    chart = next(shape.chart for shape in prs.slides[1].shapes if shape.has_chart)
    assert chart.has_title is True
    assert chart.chart_title.text_frame.text == "Past 4 Months"


def test_export_pdf_with_custom_title_still_produces_valid_pdf(monkeypatch):
    summary = {
        "offline": {"storeFormats": [], "periodTotal": [{"period_label": "August 2026", "period_start": "2026-08-01", "revenue": 5473.15, "units": 388}], "periodByFormat": []},
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "month", "mode": "offline"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(export_format="pdf", chart_style={**assistant._DEFAULT_CHART_STYLE, "title": "Past 4 Months"})],
    )

    result = assistant.ask("add a title called Past 4 Months and export as pdf", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_pptx_reflects_legend_axis_title_currency_and_markers(monkeypatch):
    from pptx import Presentation
    from pptx.enum.chart import XL_MARKER_STYLE
    import io as _io

    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    style = {
        **assistant._DEFAULT_CHART_STYLE,
        "chart_type": "line",
        "show_legend": True,
        "y_axis_label": "Revenue ($)",
        "show_value_labels": True,
        "value_label_format": "currency",
        "show_data_points": True,
    }
    _install_fake_client(monkeypatch, [tool_call, _final_answer(export_format="pptx", chart_style=style)])

    result = assistant.ask("export with legend, axis label, currency labels and markers", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    chart = next(shape.chart for shape in prs.slides[1].shapes if shape.has_chart)
    assert chart.has_legend is True
    assert chart.value_axis.has_title is True
    assert chart.value_axis.axis_title.text_frame.text == "Revenue ($)"
    assert chart.plots[0].data_labels.number_format == '"$"#,##0'
    assert chart.series[0].marker.style == XL_MARKER_STYLE.CIRCLE


def test_export_pdf_with_opacity_currency_and_markers_still_produces_valid_pdf(monkeypatch):
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    style = {
        **assistant._DEFAULT_CHART_STYLE,
        "chart_type": "line",
        "opacity": 0.5,
        "y_axis_label": "Revenue ($)",
        "show_value_labels": True,
        "value_label_format": "currency",
        "show_data_points": True,
        "font_size": "large",
    }
    _install_fake_client(monkeypatch, [tool_call, _final_answer(export_format="pdf", chart_style=style)])

    result = assistant.ask("export with opacity, axis label, currency labels and markers", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_pptx_bar_chart_includes_trend_line_as_combo_chart(monkeypatch):
    # Regression: trend line previously only showed in the chat preview,
    # not in exports at all. Verifies the real OOXML combo-chart structure
    # (a second <c:lineChart> sibling under <c:plotArea>, not just "some
    # bytes got written") round-trips correctly.
    from pptx import Presentation
    from pptx.oxml.ns import qn
    import io as _io

    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
                {"period_label": "Week 3", "period_start": "2026-08-15", "revenue": 1200.0, "units": 12},
                {"period_label": "Week 4", "period_start": "2026-08-22", "revenue": 1800.0, "units": 18},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    style = {**assistant._DEFAULT_CHART_STYLE, "show_trend_line": True}
    _install_fake_client(monkeypatch, [tool_call, _final_answer(export_format="pptx", chart_style=style)])

    result = assistant.ask("add a trend line and export as pptx", history=None, customer="fairprice")

    assert result["chart_trend_values"], "trend values should have been computed"
    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    chart = next(shape.chart for shape in prs.slides[1].shapes if shape.has_chart)
    plot_area = chart._chartSpace.chart.plotArea
    assert plot_area.find(qn("c:barChart")) is not None
    line_elm = plot_area.find(qn("c:lineChart"))
    assert line_elm is not None
    trend_vals = [pt.find(qn("c:v")).text for pt in line_elm.findall(".//" + qn("c:val") + "/" + qn("c:numRef") + "/" + qn("c:numCache") + "/" + qn("c:pt"))]
    assert [float(v) for v in trend_vals] == result["chart_trend_values"]
    assert chart.series[0].values == (1000.0, 1500.0, 1200.0, 1800.0)  # primary series untouched


def test_export_pptx_line_chart_includes_second_trend_series(monkeypatch):
    from pptx import Presentation
    from pptx.oxml.ns import qn
    import io as _io

    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
                {"period_label": "Week 3", "period_start": "2026-08-15", "revenue": 1200.0, "units": 12},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    style = {**assistant._DEFAULT_CHART_STYLE, "show_trend_line": True, "chart_type": "line"}
    _install_fake_client(monkeypatch, [tool_call, _final_answer(export_format="pptx", chart_style=style)])

    result = assistant.ask("show as line chart with trend line, export pptx", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    prs = Presentation(_io.BytesIO(decoded))
    chart = next(shape.chart for shape in prs.slides[1].shapes if shape.has_chart)
    plot_area = chart._chartSpace.chart.plotArea
    line_charts = plot_area.findall(qn("c:lineChart"))
    assert len(line_charts) == 1  # one lineChart element containing TWO series, not two lineChart siblings
    assert len(line_charts[0].findall(qn("c:ser"))) == 2
    assert chart.series[0].values == (1000.0, 1500.0, 1200.0)


def test_export_pdf_bar_chart_with_trend_line_still_produces_valid_pdf(monkeypatch):
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    style = {**assistant._DEFAULT_CHART_STYLE, "show_trend_line": True}
    _install_fake_client(monkeypatch, [tool_call, _final_answer(export_format="pdf", chart_style=style)])

    result = assistant.ask("add a trend line and export as pdf", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_pdf_line_chart_with_trend_line_still_produces_valid_pdf(monkeypatch):
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    style = {**assistant._DEFAULT_CHART_STYLE, "show_trend_line": True, "chart_type": "line"}
    _install_fake_client(monkeypatch, [tool_call, _final_answer(export_format="pdf", chart_style=style)])

    result = assistant.ask("show as line with trend line, export as pdf", history=None, customer="fairprice")

    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


def test_export_pdf_with_line_chart_type_still_produces_valid_pdf(monkeypatch):
    summary = {
        "offline": {
            "storeFormats": [],
            "periodTotal": [
                {"period_label": "Week 1", "period_start": "2026-08-01", "revenue": 1000.0, "units": 10},
                {"period_label": "Week 2", "period_start": "2026-08-08", "revenue": 1500.0, "units": 15},
            ],
            "periodByFormat": [],
        },
        "online": {"storeFormats": [], "periodTotal": [], "periodByFormat": []},
    }
    monkeypatch.setattr(bigquery, "get_dashboard_summary", lambda **kwargs: summary)

    tool_call = _tool_call_response(("tu_1", "get_sales_summary", {"granularity": "week"}))
    _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(export_format="pdf", chart_style={**assistant._DEFAULT_CHART_STYLE, "chart_type": "line"})],
    )

    result = assistant.ask("show as a line chart and export as pdf", history=None, customer="fairprice")

    assert result["chart_type"] == "line"
    decoded = base64.b64decode(result["download_base64"])
    assert decoded[:4] == b"%PDF"


# ---- get_promotions: filtering helpers --------------------------------------
# A promotion can run at more than one store (a real many-to-many via
# promotion_stores, confirmed against live data -- 3 of 5 real promotions in
# the dev DB link to 2 stores each), so `stores` is a list per promotion.

def _sample_promotion(**overrides):
    promo = {
        "promotion_id": 1,
        "period_start": datetime.date(2026, 4, 1),
        "period_end": datetime.date(2026, 4, 30),
        "period_label": "Apr 2026",
        "promo_type": "regular",
        "promotion_mechanic": "20% off",
        "voucher": None,
        "stores": [
            {"store_id": 1, "store_name": "FairPrice Jurong Point", "store_code": "JP01", "store_format": "Hypermarket", "retailer_id": 1, "retailer": "FairPrice"},
        ],
        "skus": [
            {"sku": "AP-SM-001", "sku_range": "Aire Adult Pants", "product_name": "Aire Adult Pants S/M", "size": "S/M", "brand": "Aire", "uom": "pack", "pack_size": 10, "price": 12.90, "quantity_units": None},
        ],
        "created_at": datetime.datetime(2026, 3, 1, 9, 0, 0),
        "updated_at": datetime.datetime(2026, 3, 1, 9, 0, 0),
    }
    promo.update(overrides)
    return promo


def test_promotion_matches_customer_checks_any_linked_store():
    promo = _sample_promotion(stores=[
        {"retailer": "FairPrice", "store_name": "Jurong Point"},
        {"retailer": "ColdStorage", "store_name": "Orchard"},
    ])
    assert assistant._promotion_matches_customer(promo, "fairprice") is True
    assert assistant._promotion_matches_customer(promo, "COLD") is True
    assert assistant._promotion_matches_customer(promo, "sheng siong") is False
    assert assistant._promotion_matches_customer(promo, None) is True


def test_promotion_overlaps_range():
    promo = _sample_promotion(period_start=datetime.date(2026, 4, 1), period_end=datetime.date(2026, 4, 30))
    assert assistant._promotion_overlaps_range(promo, "2026-04-15", "2026-04-20") is True  # fully inside
    assert assistant._promotion_overlaps_range(promo, "2026-03-01", "2026-04-05") is True  # overlaps start
    assert assistant._promotion_overlaps_range(promo, "2026-04-25", "2026-05-10") is True  # overlaps end
    assert assistant._promotion_overlaps_range(promo, "2026-05-01", "2026-05-31") is False  # entirely after
    assert assistant._promotion_overlaps_range(promo, "2026-01-01", "2026-01-31") is False  # entirely before
    assert assistant._promotion_overlaps_range(promo, None, None) is True


def test_promotion_matches_sku_checks_code_and_product_name():
    promo = _sample_promotion(skus=[{"sku": "AP-SM-001", "product_name": "Aire Adult Pants S/M"}])
    assert assistant._promotion_matches_sku(promo, "AP-SM-001") is True
    assert assistant._promotion_matches_sku(promo, "adult pants") is True
    assert assistant._promotion_matches_sku(promo, "widget") is False
    assert assistant._promotion_matches_sku(promo, None) is True


def test_trim_promotion_drops_dashboard_detail_noise_and_keeps_all_stores():
    trimmed = assistant._trim_promotion(_sample_promotion(stores=[
        {"store_id": 1, "store_code": "JP01", "store_format": "Hypermarket", "retailer_id": 1, "retailer": "FairPrice", "store_name": "Jurong Point"},
        {"store_id": 2, "store_code": "OR02", "store_format": "Supermarket", "retailer_id": 1, "retailer": "FairPrice", "store_name": "Orchard"},
    ]))
    assert "price" not in json.dumps(trimmed, default=str)
    assert "created_at" not in trimmed
    assert "updated_at" not in trimmed
    assert trimmed["stores"] == [
        {"retailer": "FairPrice", "store_name": "Jurong Point"},
        {"retailer": "FairPrice", "store_name": "Orchard"},
    ]
    assert "store_id" not in trimmed["stores"][0]
    assert trimmed["skus"] == ["Aire Adult Pants Aire Adult Pants S/M"]
    assert trimmed["promotion_mechanic"] == "20% off"


# ---- get_promotions: ask() integration --------------------------------------

def test_get_promotions_tool_filters_by_customer_and_date_range(monkeypatch):
    promotions = [
        _sample_promotion(period_label="Apr 2026", period_start=datetime.date(2026, 4, 1), period_end=datetime.date(2026, 4, 30), stores=[{"retailer": "FairPrice", "store_name": "Jurong Point"}]),
        _sample_promotion(period_label="Apr 2026", period_start=datetime.date(2026, 4, 1), period_end=datetime.date(2026, 4, 30), stores=[{"retailer": "ColdStorage", "store_name": "Orchard"}]),
        _sample_promotion(period_label="Jan 2026", period_start=datetime.date(2026, 1, 1), period_end=datetime.date(2026, 1, 31), stores=[{"retailer": "FairPrice", "store_name": "Jurong Point"}]),
    ]
    monkeypatch.setattr(promotion_service, "get_promotions", lambda: promotions)

    tool_call = _tool_call_response(("tu_1", "get_promotions", {"customer": "fairprice", "start_date": "2026-04-01", "end_date": "2026-04-30"}))
    fake_client = _install_fake_client(monkeypatch, [tool_call, _final_answer(text="FairPrice ran a 20% off promotion in April 2026.")])

    result = assistant.ask("what promotions did fairprice run in april 2026?", history=None, customer="fairprice")

    tool_result_message = _dump(fake_client.models.calls[1]["contents"][-1])
    function_response = json.loads(tool_result_message["parts"][0]["function_response"]["response"]["result"])
    assert len(function_response) == 1
    assert function_response[0]["stores"][0]["retailer"] == "FairPrice"
    assert function_response[0]["period_label"] == "Apr 2026"
    assert result["has_table"] is True
    assert result["table_columns"] == ["stores", "period", "type", "mechanic"]


def test_get_promotions_tool_empty_result_still_answers(monkeypatch):
    monkeypatch.setattr(promotion_service, "get_promotions", lambda: [])

    tool_call = _tool_call_response(("tu_1", "get_promotions", {"customer": "fairprice"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer(text="No promotions found for FairPrice.")])

    result = assistant.ask("what promotions has fairprice run?", history=None, customer="fairprice")

    assert result["answer"] == "No promotions found for FairPrice."
    assert result["has_table"] is False


def test_get_promotions_tool_db_failure_degrades_gracefully(monkeypatch):
    def _raise():
        raise RuntimeError("connection refused")
    monkeypatch.setattr(promotion_service, "get_promotions", _raise)

    tool_call = _tool_call_response(("tu_1", "get_promotions", {"customer": "fairprice"}))
    fake_client = _install_fake_client(
        monkeypatch,
        [tool_call, _final_answer(grounded=True, data_source="none", text="I couldn't reach the promotions database.")],
    )

    result = assistant.ask("what promotions has fairprice run?", history=None, customer="fairprice")

    tool_result_message = _dump(fake_client.models.calls[1]["contents"][-1])
    function_response = tool_result_message["parts"][0]["function_response"]
    assert "error" in function_response["response"]
    assert result["answer"] == "I couldn't reach the promotions database."


def test_get_promotions_builds_table_with_multiple_stores_joined(monkeypatch):
    promotions = [_sample_promotion(
        promo_type="side_offer",
        promotion_mechanic="Buy 1 Get 1",
        stores=[
            {"retailer": "FairPrice", "store_name": "Jurong Point"},
            {"retailer": "FairPrice", "store_name": "Orchard"},
        ],
    )]
    monkeypatch.setattr(promotion_service, "get_promotions", lambda: promotions)

    tool_call = _tool_call_response(("tu_1", "get_promotions", {"customer": "fairprice"}))
    _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    result = assistant.ask("what promotions has fairprice run?", history=None, customer="fairprice")

    assert result["has_chart"] is False
    assert result["has_table"] is True
    assert result["table_rows"][0] == ["FairPrice - Jurong Point; FairPrice - Orchard", "Apr 2026", "side_offer", "Buy 1 Get 1"]


def test_get_promotions_tool_scoped_by_sku(monkeypatch):
    promotions = [
        _sample_promotion(skus=[{"sku": "AP-SM-001", "product_name": "Aire Adult Pants S/M"}]),
        _sample_promotion(skus=[{"sku": "AP-XL-001", "product_name": "Aire Adult Pants XL"}]),
    ]
    monkeypatch.setattr(promotion_service, "get_promotions", lambda: promotions)

    tool_call = _tool_call_response(("tu_1", "get_promotions", {"customer": "fairprice", "sku": "XL"}))
    fake_client = _install_fake_client(monkeypatch, [tool_call, _final_answer()])

    assistant.ask("was the XL pants sku ever on promotion?", history=None, customer="fairprice")

    tool_result_message = _dump(fake_client.models.calls[1]["contents"][-1])
    function_response = json.loads(tool_result_message["parts"][0]["function_response"]["response"]["result"])
    assert len(function_response) == 1
    assert "XL" in function_response[0]["skus"][0]


# ---- generate_digest: pure helpers -------------------------------------------

def test_rank_movers_picks_top_n_by_absolute_delta():
    current = [
        {"sku": "A", "product_name": "Widget A", "rank": 1},
        {"sku": "B", "product_name": "Widget B", "rank": 2},
        {"sku": "C", "product_name": "Widget C", "rank": 3},
        {"sku": "D", "product_name": "Widget D", "rank": 4},
    ]
    previous = [
        {"sku": "A", "rank": 1},   # no change -- excluded
        {"sku": "B", "rank": 5},   # moved up 3
        {"sku": "C", "rank": 2},   # moved down 1
        {"sku": "D", "rank": 10},  # moved up 6 -- biggest mover
    ]

    movers = assistant._rank_movers(current, previous, limit=2)

    assert [m["sku"] for m in movers] == ["D", "B"]
    assert movers[0]["delta"] == 6
    assert movers[0]["previous_rank"] == 10
    assert movers[0]["current_rank"] == 4


def test_rank_movers_skips_skus_missing_from_either_period():
    current = [{"sku": "A", "product_name": "Widget A", "rank": 1}]
    previous = [{"sku": "B", "rank": 1}]  # different SKU entirely

    assert assistant._rank_movers(current, previous) == []


def test_promotions_starting_or_ending_soon_windows_by_date_and_customer():
    today = datetime.date.today()
    promos = [
        _sample_promotion(  # starts in 3 days -- within window
            period_start=today + datetime.timedelta(days=3),
            period_end=today + datetime.timedelta(days=30),
            stores=[{"retailer": "FairPrice", "store_name": "Jurong Point"}],
        ),
        _sample_promotion(  # ends in 5 days -- within window
            period_start=today - datetime.timedelta(days=20),
            period_end=today + datetime.timedelta(days=5),
            stores=[{"retailer": "FairPrice", "store_name": "Orchard"}],
        ),
        _sample_promotion(  # far in the future -- outside the 7-day window
            period_start=today + datetime.timedelta(days=60),
            period_end=today + datetime.timedelta(days=90),
            stores=[{"retailer": "FairPrice", "store_name": "Bedok"}],
        ),
        _sample_promotion(  # in window but wrong retailer
            period_start=today + datetime.timedelta(days=1),
            period_end=today + datetime.timedelta(days=10),
            stores=[{"retailer": "ColdStorage", "store_name": "Somewhere"}],
        ),
    ]

    result = assistant._promotions_starting_or_ending_soon(promos, "fairprice", days=7)

    stores_seen = {s["store_name"] for p in result for s in p["stores"]}
    assert stores_seen == {"Jurong Point", "Orchard"}


# ---- generate_digest: end-to-end ---------------------------------------------

def _digest_answer(text="- Revenue trend was strong.", follow_ups=None):
    payload = {
        "answer": text,
        "follow_up_prompts": follow_ups or ["What drove this?", "Show me last month too?"],
    }
    return FakeResponse(
        text=json.dumps(payload),
        content={"role": "model", "parts": [{"text": json.dumps(payload)}]},
    )


def test_generate_digest_builds_chart_from_wow_comparison(monkeypatch):
    trend = {
        "current": {"start": "2026-09-08", "end": "2026-09-14", "revenue": 12000.0, "units": 900.0},
        "previous": {"start": "2026-09-01", "end": "2026-09-07", "revenue": 10000.0, "units": 800.0, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: trend)
    monkeypatch.setattr(bigquery, "get_sku_ranking", lambda **kwargs: pd.DataFrame([]))
    monkeypatch.setattr(promotion_service, "get_promotions", lambda: [])
    _install_fake_client(monkeypatch, [_digest_answer()])

    result = assistant.generate_digest(customer="fairprice")

    assert result["has_chart"] is True
    assert result["chart_categories"] == ["Previous", "Current"]
    assert result["chart_series"] == [{"label": "Revenue", "values": [10000.0, 12000.0]}]
    assert result["grounded"] is True
    assert result["data_source"] == "aire_data"
    assert result["answer"] == "- Revenue trend was strong."


def test_generate_digest_includes_rank_movers_and_promotions_in_facts_sent_to_model(monkeypatch):
    trend = {
        "current": {"start": "2026-09-08", "end": "2026-09-14", "revenue": 12000.0, "units": 900.0},
        "previous": {"start": "2026-09-01", "end": "2026-09-07", "revenue": 10000.0, "units": 800.0, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: trend)

    def fake_ranking(**kwargs):
        if kwargs.get("start_date") == "2026-09-08":
            return pd.DataFrame([{"sku": "A", "product_name": "Widget A", "rank": 1}])
        return pd.DataFrame([{"sku": "A", "product_name": "Widget A", "rank": 5}])

    monkeypatch.setattr(bigquery, "get_sku_ranking", fake_ranking)

    today = datetime.date.today()
    promos = [_sample_promotion(
        period_start=today + datetime.timedelta(days=1),
        period_end=today + datetime.timedelta(days=10),
        promotion_mechanic="20% off",
        stores=[{"retailer": "FairPrice", "store_name": "Jurong Point"}],
    )]
    monkeypatch.setattr(promotion_service, "get_promotions", lambda: promos)

    fake_client = _install_fake_client(monkeypatch, [_digest_answer()])

    assistant.generate_digest(customer="fairprice")

    facts_sent = fake_client.models.calls[0]["contents"][0]["parts"][0]["text"]
    assert "Widget A" in facts_sent
    assert "rank 5 -> 1" in facts_sent
    assert "20% off" in facts_sent


def test_generate_digest_promotions_db_failure_degrades_gracefully(monkeypatch):
    trend = {
        "current": {"start": None, "end": None, "revenue": 0.0, "units": 0.0},
        "previous": {"start": None, "end": None, "revenue": 0.0, "units": 0.0, "available": False},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: trend)

    def _raise():
        raise RuntimeError("connection refused")
    monkeypatch.setattr(promotion_service, "get_promotions", _raise)
    _install_fake_client(monkeypatch, [_digest_answer()])

    result = assistant.generate_digest(customer="fairprice")

    assert result["answer"] == "- Revenue trend was strong."
    assert result["has_chart"] is False


def test_generate_digest_refusal_still_returns_a_usable_response(monkeypatch):
    trend = {
        "current": {"start": "2026-09-08", "end": "2026-09-14", "revenue": 12000.0, "units": 900.0},
        "previous": {"start": "2026-09-01", "end": "2026-09-07", "revenue": 10000.0, "units": 800.0, "available": True},
    }
    monkeypatch.setattr(bigquery, "get_period_comparison", lambda **kwargs: trend)
    monkeypatch.setattr(bigquery, "get_sku_ranking", lambda **kwargs: pd.DataFrame([]))
    monkeypatch.setattr(promotion_service, "get_promotions", lambda: [])
    blocked = FakeResponse(finish_reason="SAFETY", content={"role": "model", "parts": []})
    _install_fake_client(monkeypatch, [blocked])

    result = assistant.generate_digest(customer="fairprice")

    assert result["answer"]
    assert result["has_chart"] is True  # the chart is still built from real data regardless
