"""
Plain-English business-question assistant.

Gemini (via Vertex AI / Gemini Enterprise) picks which of the read-only
tools below to call (each a thin wrapper around an existing bigquery.py
function, plus Google Search grounding for general market data) and, once
it has what it needs, must answer in a fixed JSON shape (see
FINAL_ANSWER_SCHEMA) rather than free text.

Grounding is enforced structurally, not just by prompting: the chart/table
shown to the user is built here, by us, straight from whichever business
tool's raw return value was actually used to answer -- the model only writes
the narrative text, never the numbers that get charted, so the two cannot
drift apart the way they could if the model were asked to re-type the
figures into its own JSON.
"""

import io
import os
import re
import json
import copy
import base64
import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai import errors as genai_errors
from google.auth.exceptions import DefaultCredentialsError
from google.api_core.exceptions import GoogleAPICallError
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer
from reportlab.graphics.shapes import Drawing, String, PolyLine
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.widgets.markers import makeMarker
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_MARKER_STYLE
from pptx.enum.text import MSO_AUTO_SIZE
from pptx.dml.color import RGBColor
from pptx.oxml.ns import qn
from lxml import etree
from openpyxl import Workbook
from openpyxl.chart import BarChart as XlsxBarChart, Reference
from openpyxl.styles import Font as XlsxFont, Alignment as XlsxAlignment

from app.services import bigquery, promotion_service, sellout_lookup

ENV_PATH = Path(__file__).resolve().parents[2] / ".env.backend"
load_dotenv(ENV_PATH)

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
GCP_VERTEX_LOCATION = os.environ.get("GCP_VERTEX_LOCATION", "us-central1")

MODEL = os.environ.get("GEMINI_ASSISTANT_MODEL", "gemini-2.5-flash")

MAX_TOOL_ITERATIONS = 8


class AssistantConfigError(Exception):
    """GCP project/credentials for Vertex AI are missing or unusable."""


class AssistantLoopError(Exception):
    """The model never settled on a final answer within MAX_TOOL_ITERATIONS."""


_client: genai.Client | None = None


def get_client() -> genai.Client:
    """Lazy singleton, mirrors generate_mapping.get_client()."""
    global _client
    if _client is None:
        if not GCP_PROJECT_ID:
            raise AssistantConfigError("GCP_PROJECT_ID is not set")
        _client = genai.Client(enterprise=True, project=GCP_PROJECT_ID, location=GCP_VERTEX_LOCATION)
    return _client


# ---- Tool definitions ---------------------------------------------------

_FUNCTION_SCHEMAS = [
    {
        "name": "get_sales_summary",
        "description": (
            "Revenue and units for a customer, bucketed by week or month, "
            "split into offline/online channels and store format. Use for "
            "\"how is revenue/units trending\" questions over a date range."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer": {"type": "string", "description": "Retailer/customer, e.g. 'fairprice'. Defaults to the current page's customer if omitted."},
                "granularity": {"type": "string", "enum": ["week", "month"], "description": "Defaults to 'week'."},
                "mode": {"type": "string", "enum": ["offline", "online"], "description": "Restrict to one channel -- pass this whenever the question names a specific channel (e.g. \"offline sales\"). Omit only when the question genuinely wants both channels combined."},
                "sku": {"type": "string", "description": "Optional exact SKU code to scope to one product."},
                "store": {"type": "string", "description": "Optional exact store_code to scope to one branch."},
                "start_date": {"type": "string", "description": "YYYY-MM-DD, inclusive."},
                "end_date": {"type": "string", "description": "YYYY-MM-DD, inclusive."},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "compare_periods",
        "description": (
            "Compares total revenue/units between two periods -- either a "
            "week-over-week/month-over-month/year-over-year preset (each "
            "auto-derived from the latest available data), or two explicit "
            "date ranges. Use for \"vs last week/month/year\" questions. "
            "ALSO the right tool for a single total across a date range that "
            "spans more than one get_sales_summary period (e.g. \"total "
            "revenue from Jan to Jul\"): set current_start/current_end to "
            "that range and read current.revenue -- it's computed with SQL "
            "SUM(), not by adding up multiple rows yourself. previous_start/"
            "previous_end can be left to their default and ignored in your "
            "answer if the question wasn't actually a comparison."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer": {"type": "string"},
                "comparison_type": {"type": "string", "enum": ["wow", "mom", "yoy"], "description": "Omit if giving explicit dates instead."},
                "current_start": {"type": "string"},
                "current_end": {"type": "string"},
                "previous_start": {"type": "string"},
                "previous_end": {"type": "string"},
                "mode": {"type": "string", "enum": ["offline", "online"], "description": "Omit to combine both channels."},
                "sku": {"type": "string"},
                "store": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "rank_skus",
        "description": (
            "Ranks SKUs by total revenue or units sold over whatever date "
            "range/filters are given (all history if none). Use for "
            "\"best/worst sellers\", \"top N products\" questions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer": {"type": "string"},
                "metric": {"type": "string", "enum": ["value", "volume"], "description": "value=revenue, volume=units. Defaults to 'value'."},
                "order": {"type": "string", "enum": ["asc", "desc"], "description": "Defaults to 'desc' (highest first)."},
                "mode": {"type": "string", "enum": ["offline", "online"]},
                "sku": {"type": "string"},
                "store": {"type": "string"},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "list_customers",
        "description": "Lists the customers/retailers we have sales data for. Use to resolve a name the user typed to an exact value.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_stores",
        "description": "Lists store branches for a customer. Use to resolve a store name/branch the user typed to an exact store_code.",
        "input_schema": {
            "type": "object",
            "properties": {"customer": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "list_skus",
        "description": "Lists SKUs (product code + name) for a customer. Use to resolve a product name the user typed to an exact SKU code.",
        "input_schema": {
            "type": "object",
            "properties": {"customer": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_promotions",
        "description": (
            "Looks up promotion records (retailer/store(s), date range, promo type, "
            "mechanic/discount, which SKUs were included) from the promotions catalog -- "
            "a SEPARATE system from sales figures, no revenue numbers here. Use this to "
            "answer direct questions about promotions, AND whenever reasoning about WHY "
            "sales rose or fell in a period -- check here for an actual promotion before "
            "speculating about generic causes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer": {"type": "string", "description": "Retailer name, e.g. 'fairprice'. Matches substrings, case-insensitive. Defaults to the current page's customer if omitted."},
                "start_date": {"type": "string", "description": "YYYY-MM-DD. Returns promotions whose period overlaps [start_date, end_date] at all."},
                "end_date": {"type": "string", "description": "YYYY-MM-DD."},
                "sku": {"type": "string", "description": "Optional SKU code or product name substring to scope to promotions covering that product."},
            },
            "additionalProperties": False,
        },
    },
]

# Gemini rejects mixing custom function tools with Google
# Search grounding in one request ("Multiple tools are supported only when
# they are all search tools"), So business questions run against _BUSINESS_TOOLS first; only if that
# can't answer (grounded=false) does ask() retry once with _SEARCH_TOOLS,
# matching the system prompt's "prefer internal data, search only for
# genuinely external questions" policy.
_BUSINESS_TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name=schema["name"],
                description=schema["description"],
                parameters_json_schema=schema["input_schema"],
            )
            for schema in _FUNCTION_SCHEMAS
        ]
    ),
]

_SEARCH_TOOLS = [types.Tool(google_search=types.GoogleSearch())]

# Tools whose raw results feed _build_chart -- despite the name, not all of
# these produce a bar/line chart (rank_skus and get_promotions only ever
# produce a table). The list_* lookups and web_search never populate
# chart/table at all.
_CHARTABLE_TOOLS = {"get_sales_summary", "compare_periods", "rank_skus", "get_promotions"}


# ---- Executing a tool call -----------------------------------------------

def _run_business_tool(name: str, tool_input: dict, default_customer: str):
    """
    Returns (content_for_model: str, is_error: bool, raw_result: object|None).

    raw_result is only used by _build_chart below -- it's never sent back to
    the model as-is (it goes through the same JSON content the model reads),
    kept separately so the chart-building step can't accidentally diverge
    from what the model actually saw.
    """
    customer = tool_input.get("customer") or default_customer
    try:
        if name == "get_sales_summary":
            result = bigquery.get_dashboard_summary(
                granularity=tool_input.get("granularity", "week"),
                sku=tool_input.get("sku"),
                customer=customer,
                store=tool_input.get("store"),
                start_date=tool_input.get("start_date"),
                end_date=tool_input.get("end_date"),
            )
            # get_dashboard_summary always computes both channels (it feeds
            # the dashboard's Offline/Online toggle, which needs both ready
            # without a refetch) -- filter down when the question was
            # actually scoped to one, so a channel-specific answer's chart
            # can't end up silently combining both (see _sales_summary_periods,
            # which sums whatever channels are present in this dict).
            requested_mode = tool_input.get("mode")
            if requested_mode in bigquery.DASHBOARD_MODES:
                result = {requested_mode: result.get(requested_mode, {})}
        elif name == "compare_periods":
            result = bigquery.get_period_comparison(
                comparison_type=tool_input.get("comparison_type"),
                current_start=tool_input.get("current_start"),
                current_end=tool_input.get("current_end"),
                previous_start=tool_input.get("previous_start"),
                previous_end=tool_input.get("previous_end"),
                mode=tool_input.get("mode"),
                sku=tool_input.get("sku"),
                customer=customer,
                store=tool_input.get("store"),
            )
        elif name == "rank_skus":
            df = bigquery.get_sku_ranking(
                metric=tool_input.get("metric", "value"),
                order=tool_input.get("order", "desc"),
                sku=tool_input.get("sku"),
                mode=tool_input.get("mode"),
                customer=customer,
                store=tool_input.get("store"),
                start_date=tool_input.get("start_date"),
                end_date=tool_input.get("end_date"),
            )
            result = df.to_dict(orient="records")
        elif name == "list_customers":
            result = bigquery.get_customer_options()
        elif name == "list_stores":
            result = bigquery.get_store_options(customer=customer)
        elif name == "list_skus":
            result = bigquery.get_sku_options(customer=customer)
        elif name == "get_promotions":
            # Cloud SQL/Postgres, not BigQuery -- a genuinely different
            # failure domain than the exceptions caught below, so it gets
            # its own broad catch rather than being narrowed to a specific
            # exception type.
            try:
                promotions = promotion_service.get_promotions()
            except Exception as e:
                return (f"Unable to reach the promotions database: {e}", True, None)
            result = _filter_promotions(
                promotions,
                customer=customer,
                start_date=tool_input.get("start_date"),
                end_date=tool_input.get("end_date"),
                sku=tool_input.get("sku"),
            )
        else:
            return (f"Unknown tool: {name}", True, None)
    except ValueError as e:
        return (f"Invalid arguments: {e}", True, None)
    except DefaultCredentialsError:
        return ("BigQuery credentials are not configured on the server.", True, None)
    except GoogleAPICallError as e:
        return (f"Unable to reach BigQuery: {e.message}", True, None)
    except sellout_lookup.CatalogUnavailableError as e:
        return (f"Unable to reach the store/product catalog needed to label sales data: {e}", True, None)

    return (json.dumps(result, default=str), False, result)


# ---- Promotions filtering (Postgres has no filter params on get_promotions,
# so this happens in Python -- a smaller, safer change than adding SQL
# filters to an unfamiliar file for what's realistically a small table).
# A promotion can run at MORE THAN ONE store (a real many-to-many via
# promotion_stores -- confirmed against the live data, not assumed), so
# `stores` is a list, not a single retailer/store pair. ---------------------

def _promotion_matches_customer(promo: dict, customer: str | None) -> bool:
    if not customer:
        return True
    needle = customer.lower()
    return any(needle in (store.get("retailer") or "").lower() for store in (promo.get("stores") or []))


def _promotion_overlaps_range(promo: dict, start_date: str | None, end_date: str | None) -> bool:
    if not start_date and not end_date:
        return True
    promo_start, promo_end = promo.get("period_start"), promo.get("period_end")
    if promo_start is None or promo_end is None:
        return True
    try:
        if start_date:
            start = start_date if isinstance(start_date, datetime.date) else datetime.date.fromisoformat(start_date)
            if promo_end < start:
                return False
        if end_date:
            end = end_date if isinstance(end_date, datetime.date) else datetime.date.fromisoformat(end_date)
            if promo_start > end:
                return False
    except ValueError:
        return True
    return True


def _promotion_matches_sku(promo: dict, sku: str | None) -> bool:
    if not sku:
        return True
    needle = sku.lower()
    return any(
        needle in (line.get("sku") or "").lower() or needle in (line.get("product_name") or "").lower()
        for line in promo.get("skus") or []
    )


def _trim_promotion(promo: dict) -> dict:
    """
    Chat-friendly shape -- drops store_id/store_code/store_format/retailer_id
    and sku price/uom/pack_size/created_at/updated_at, which are
    dashboard-detail noise the model doesn't need to reason about promotion
    timing/mechanics/scope.
    """
    return {
        "stores": [
            {"retailer": store.get("retailer"), "store_name": store.get("store_name")}
            for store in (promo.get("stores") or [])
        ],
        "period_label": promo.get("period_label"),
        "period_start": promo.get("period_start"),
        "period_end": promo.get("period_end"),
        "promo_type": promo.get("promo_type"),
        "promotion_mechanic": promo.get("promotion_mechanic"),
        "voucher": promo.get("voucher"),
        "skus": [f"{line.get('sku_range', '')} {line.get('product_name', '')}".strip() for line in (promo.get("skus") or [])],
    }


def _filter_promotions(
    promotions: list[dict], customer: str | None, start_date: str | None, end_date: str | None, sku: str | None
) -> list[dict]:
    matches = [
        promo for promo in promotions
        if _promotion_matches_customer(promo, customer)
        and _promotion_overlaps_range(promo, start_date, end_date)
        and _promotion_matches_sku(promo, sku)
    ]
    return [_trim_promotion(promo) for promo in matches]


def _promotions_starting_or_ending_soon(promotions: list[dict], customer: str | None, days: int = 7) -> list[dict]:
    """Used by generate_digest -- promotions worth flagging as upcoming/wrapping up soon."""
    today = datetime.date.today()
    horizon = today + datetime.timedelta(days=days)
    matches = []
    for promo in promotions:
        if not _promotion_matches_customer(promo, customer):
            continue
        start, end = promo.get("period_start"), promo.get("period_end")
        if start is None or end is None:
            continue
        if (today <= start <= horizon) or (today <= end <= horizon):
            matches.append(promo)
    return [_trim_promotion(promo) for promo in matches]


def _rank_movers(current_ranks: list[dict], previous_ranks: list[dict], limit: int = 3) -> list[dict]:
    """
    Top SKUs by absolute rank change between two rank_skus snapshots for
    generate_digest, matched by sku code. A SKU present in only one period
    has no rank delta to compute and is skipped -- a deliberate v1
    simplification (new/discontinued SKUs aren't flagged as "movers"), not
    a silent drop.
    """
    previous_by_sku = {row.get("sku"): row for row in previous_ranks}
    movers = []
    for row in current_ranks:
        sku = row.get("sku")
        previous_row = previous_by_sku.get(sku)
        if previous_row is None:
            continue
        delta = previous_row.get("rank", 0) - row.get("rank", 0)
        if delta == 0:
            continue
        movers.append({
            "sku": sku,
            "product_name": row.get("product_name"),
            "current_rank": row.get("rank"),
            "previous_rank": previous_row.get("rank"),
            "delta": delta,
        })
    movers.sort(key=lambda m: abs(m["delta"]), reverse=True)
    return movers[:limit]


def _sales_summary_periods(raw_result) -> list[dict]:
    """
    Combined (offline + online) revenue per period.

    get_dashboard_summary always returns both channels split apart. Picking
    just one (as this used to) diverges from the all-channel total a
    headline answer naturally cites (e.g. "$25,915 vs $23,703") whenever the
    model answers from get_sales_summary alone instead of calling
    compare_periods -- summing both channels here is what actually matches
    a "total revenue" figure.
    """
    combined: dict[str, float] = {}
    order: list[str] = []
    for mode_data in (raw_result.get("offline"), raw_result.get("online")):
        for row in (mode_data or {}).get("periodTotal") or []:
            label = row["period_label"]
            if label not in combined:
                combined[label] = 0.0
                order.append(label)
            combined[label] += row["revenue"]
    return [{"period_label": label, "revenue": round(combined[label], 2)} for label in order]


def _is_real_comparison(calls: list[tuple[dict, object]]) -> bool:
    """
    True only if a comparison was actually requested (a wow/mom/yoy preset,
    or explicit previous_start/previous_end) -- not just because
    compare_periods was the tool called. Its tool description now also
    doubles as "the way to get a single SQL-summed total across a date
    range" (current_start/current_end alone, letting previous_* default),
    used specifically to avoid the model hand-adding several
    get_sales_summary rows itself and getting the arithmetic wrong. That
    auto-derived "previous" side is real data, but showing it as a
    Previous-vs-Current chart for a question that was never a comparison
    misrepresents what was actually asked.
    """
    return any(
        tool_input.get("comparison_type") or (tool_input.get("previous_start") and tool_input.get("previous_end"))
        for tool_input, _ in calls
    )


def _range_label(calls: list[tuple[dict, object]]) -> str | None:
    """"start to end" from whichever call's current period has dates, for
    labeling the single-bar range-total chart."""
    for _, raw in calls:
        current = (raw or {}).get("current") or {}
        if current.get("start") and current.get("end"):
            return f"{current['start']} to {current['end']}"
    return None


def _compare_periods_totals(calls: list[tuple[dict, object]]) -> tuple[float, float] | None:
    """
    (previous_revenue, current_revenue) for a comparison chart, from however
    many compare_periods calls were made.

    A call with no `mode` argument already returns the combined (all-channel)
    total -- prefer it outright. Otherwise, calls can be scoped per-channel
    (mode="offline"/"online"), e.g. when the model queries each channel
    separately to narrate a per-channel breakdown; in that case, SUM the
    channel-scoped calls back into a combined total, the same reasoning as
    _sales_summary_periods below -- a single scoped call, picked arbitrarily,
    would show one channel's numbers under a headline citing the combined
    total. Only when a single scoped call is all that's available (the
    question was genuinely channel-specific) is it used as-is.
    """
    unscoped = [raw for tool_input, raw in calls if not tool_input.get("mode")]
    if unscoped:
        raw_result = unscoped[-1]
        current = raw_result.get("current") or {}
        previous = raw_result.get("previous") or {}
        if current.get("start") is None:
            return None
        return previous.get("revenue", 0), current.get("revenue", 0)

    by_mode: dict[str, object] = {}
    for tool_input, raw in calls:
        mode = tool_input.get("mode")
        if mode:
            by_mode[mode] = raw

    if len(by_mode) >= 2:
        prev_total, cur_total = 0.0, 0.0
        for raw_result in by_mode.values():
            current = raw_result.get("current") or {}
            previous = raw_result.get("previous") or {}
            if current.get("start") is None:
                continue
            prev_total += previous.get("revenue", 0)
            cur_total += current.get("revenue", 0)
        return round(prev_total, 2), round(cur_total, 2)

    if len(by_mode) == 1:
        raw_result = next(iter(by_mode.values()))
        current = raw_result.get("current") or {}
        previous = raw_result.get("previous") or {}
        if current.get("start") is None:
            return None
        return previous.get("revenue", 0), current.get("revenue", 0)

    return None


def _range_total_breakdown_chart(compare_calls: list[tuple[dict, object]], customer: str, current_revenue: float, current_label: str) -> dict:
    """
    compare_periods used as a range-total calculator, for a range spanning
    more than ~a month: a single flat bar for the whole range is much less
    useful than a monthly trend, so fetch one fresh -- server-side, not via
    another model tool call, so there's no risk of the model mismatching
    scope (customer/mode/dates) between two separate calls. Falls back to
    the single-bar shape if the range is short, or the fetch comes back
    empty for any reason.
    """
    tool_input, raw = compare_calls[-1]
    current = (raw or {}).get("current") or {}
    start, end = current.get("start"), current.get("end")
    single_bar = {
        "has_chart": True,
        "chart_type": "bar",
        "chart_categories": [current_label],
        "chart_series": [{"label": "Revenue", "values": [current_revenue]}],
        "has_table": False,
        "table_columns": [],
        "table_rows": [],
    }
    if not start or not end:
        return single_bar
    try:
        span_days = (datetime.date.fromisoformat(end) - datetime.date.fromisoformat(start)).days
    except ValueError:
        return single_bar
    if span_days <= 31:
        return single_bar

    effective_customer = tool_input.get("customer") or customer
    mode = tool_input.get("mode")
    try:
        summary = bigquery.get_dashboard_summary(
            granularity="month", customer=effective_customer, start_date=start, end_date=end,
        )
    except Exception:
        return single_bar
    if mode in bigquery.DASHBOARD_MODES:
        summary = {mode: summary.get(mode, {})}
    periods = _sales_summary_periods(summary)
    if not periods:
        return single_bar

    return {
        "has_chart": True,
        "chart_type": "bar",
        "chart_categories": [row["period_label"] for row in periods],
        "chart_series": [{"label": "Revenue", "values": [row["revenue"] for row in periods]}],
        "has_table": False,
        "table_columns": [],
        "table_rows": [],
    }


def _build_chart(chart_sources: list[tuple[str, dict, object]], customer: str) -> dict:
    """
    Deterministic, backend-owned shaping -- the model never sees or produces
    these numbers, it only narrates what's already here.

    Priority is fixed (compare_periods > get_sales_summary > rank_skus), not
    "whichever tool was called last": a comparison question's headline
    figure is the ALL-CHANNEL total, which get_sales_summary's per-channel
    numbers don't directly match -- see _compare_periods_totals and
    _sales_summary_periods for how each tool's own calls get reconciled
    into a single combined total before it's ever compared across tools.
    """
    if not chart_sources:
        return _empty_chart()

    compare_calls = [(tool_input, raw) for name, tool_input, raw in chart_sources if name == "compare_periods"]
    if compare_calls:
        totals = _compare_periods_totals(compare_calls)
        if totals is not None:
            previous_revenue, current_revenue = totals
            if not _is_real_comparison(compare_calls):
                # compare_periods was used purely as a range-total calculator
                # -- show the one figure that was actually asked about, not
                # an auto-derived "Previous" the question never requested.
                current_label = _range_label(compare_calls) or "Total"
                return _range_total_breakdown_chart(compare_calls, customer, current_revenue, current_label)
            return {
                "has_chart": True,
                "chart_type": "bar",
                "chart_categories": ["Previous", "Current"],
                "chart_series": [{"label": "Revenue", "values": [previous_revenue, current_revenue]}],
                "has_table": False,
                "table_columns": [],
                "table_rows": [],
            }

    summary_results = [raw for name, tool_input, raw in chart_sources if name == "get_sales_summary"]
    if summary_results:
        categories: list[str] = []
        values: list[float] = []
        for raw_result in summary_results:
            for row in _sales_summary_periods(raw_result):
                categories.append(row["period_label"])
                values.append(row["revenue"])
        if categories:
            return {
                "has_chart": True,
                "chart_type": "bar",
                "chart_categories": categories,
                "chart_series": [{"label": "Revenue", "values": values}],
                "has_table": False,
                "table_columns": [],
                "table_rows": [],
            }

    rank_results = [raw for name, tool_input, raw in chart_sources if name == "rank_skus"]
    if rank_results:
        rows = rank_results[-1] or []
        if rows:
            return {
                "has_chart": False,
                "chart_type": "none",
                "chart_categories": [],
                "chart_series": [],
                "has_table": True,
                "table_columns": ["rank", "product_name", "volume", "value"],
                "table_rows": [
                    [str(r.get("rank", "")), str(r.get("product_name", "")), str(r.get("volume", "")), str(r.get("value", ""))]
                    for r in rows[:10]
                ],
            }

    promotion_results = [raw for name, tool_input, raw in chart_sources if name == "get_promotions"]
    if promotion_results:
        rows = promotion_results[-1] or []
        if rows:
            return {
                "has_chart": False,
                "chart_type": "none",
                "chart_categories": [],
                "chart_series": [],
                "has_table": True,
                "table_columns": ["stores", "period", "type", "mechanic"],
                "table_rows": [
                    [
                        "; ".join(f"{s.get('retailer', '')} - {s.get('store_name', '')}" for s in (p.get("stores") or [])) or "—",
                        str(p.get("period_label", "")),
                        str(p.get("promo_type", "")),
                        str(p.get("promotion_mechanic", "")),
                    ]
                    for p in rows[:10]
                ],
            }

    return _empty_chart()


def _empty_chart() -> dict:
    return {
        "has_chart": False,
        "chart_type": "none",
        "chart_categories": [],
        "chart_series": [],
        "has_table": False,
        "table_columns": [],
        "table_rows": [],
    }


def _resolve_last_chart(chart: dict, last_chart: dict | None) -> dict:
    """
    Falls back to the chart the frontend says is already on screen when this
    turn made no chartable tool call (has_chart/has_table both false) -- not
    just for styling follow-ups ("make it red") but any follow-up about the
    same answer ("why is that"), which is more correct than silently
    dropping the chart just because nothing was re-fetched this turn.
    """
    if chart.get("has_chart") or chart.get("has_table"):
        return chart
    if last_chart and (last_chart.get("has_chart") or last_chart.get("has_table")):
        return last_chart
    return chart


def _resolve_chart_type(chart: dict, chart_style: dict) -> dict:
    """
    Relabels chart["chart_type"] when the user explicitly asked for
    bar/line, without touching chart_categories/chart_series -- the same
    numbers just get drawn differently. 'auto' (the default) leaves
    whatever _build_chart/_resolve_last_chart already produced untouched.
    """
    requested = chart_style.get("chart_type", "auto")
    if requested in ("bar", "line") and chart.get("chart_type") != requested and chart.get("has_chart"):
        return {**chart, "chart_type": requested}
    return chart


_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _sanitize_color(value: str | None) -> str:
    """Only a literal 'default' or a well-formed #RRGGBB hex survives -- a
    stray color name or malformed value the model didn't convert falls back
    to 'default' rather than being handed to the frontend/export builders
    as-is."""
    if value == "default" or (value and _HEX_COLOR_RE.match(value)):
        return value
    return "default"


def _linear_trend(values: list[float]) -> list[float]:
    """
    Ordinary least squares fit over index positions 0..n-1 -- pure
    arithmetic on numbers already in chart_series, never model-derived, so a
    "add a trend line" request can't introduce a fabricated figure the way
    asking the model to eyeball a trend could.
    """
    n = len(values)
    if n < 2:
        return []
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(values) / n
    denominator = sum((x - mean_x) ** 2 for x in xs)
    if denominator == 0:
        return [mean_y] * n
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, values)) / denominator
    intercept = mean_y - slope * mean_x
    return [round(intercept + slope * x, 2) for x in xs]


# ---- Export as PDF/PPTX -----------------------------------------------------
#
# Built from the already-correct `chart` dict _build_chart produced -- file
# bytes are generated entirely here in Python and base64-encoded, never
# round-tripped through the model, same reasoning as the chart/table numbers
# themselves never being. A generation failure degrades to no download
# rather than breaking the whole answer, since the export is additive.

_AIRE_BRAND_COLOR = colors.HexColor("#2b2560")


def _resolve_bar_color(chart_style: dict | None) -> str:
    """Hex string (no '#') for python-pptx, used alongside the reportlab
    colors.HexColor form separately -- 'default' or a missing style falls
    back to the AireOS brand color exactly as before this feature existed."""
    color = (chart_style or {}).get("color", "default")
    if color == "default" or not _HEX_COLOR_RE.match(color or ""):
        return "2b2560"
    return color.lstrip("#")


def _empty_download() -> dict:
    return {
        "has_download": False,
        "download_filename": None,
        "download_mime_type": None,
        "download_base64": None,
    }


def _split_into_points(text: str) -> list[str] | None:
    """
    If the model's own answer text is already shaped as a bullet list
    (lines starting with "- ", per the analysis-mode prompt rule), returns
    the individual points so exports can render them as real bullets
    instead of one dense paragraph. Purely a presentation split of text the
    model already wrote -- never rewrites or summarizes content. Returns
    None (render as a single paragraph, today's existing behavior) when
    there's nothing bullet-shaped to split.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    points = [line[2:].strip() for line in lines if line.startswith("- ")]
    return points if len(points) >= 2 else None


def _build_pdf(answer_text: str, chart: dict, chart_style: dict | None = None, trend_values: list[float] | None = None) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title="AireOS Report")
    styles = getSampleStyleSheet()
    elements = [
        Paragraph("AireOS Report", styles["Title"]),
        Spacer(1, 6),
        Paragraph(datetime.date.today().strftime("%B %d, %Y"), styles["Normal"]),
        Spacer(1, 16),
    ]
    points = _split_into_points(answer_text)
    if points:
        for point in points:
            elements.append(Paragraph(f"&bull; {point}", styles["Normal"]))
            elements.append(Spacer(1, 4))
    else:
        elements.append(Paragraph(answer_text, styles["Normal"]))
    elements.append(Spacer(1, 16))

    if chart.get("has_chart"):
        categories = chart["chart_categories"]
        values = chart["chart_series"][0]["values"]
        style = chart_style or {}
        label_format = {"whole_number": "%d", "currency": "$%0.0f"}.get(style.get("value_label_format"), "%0.2f")
        label_font_size = FONT_SIZE_PT.get(style.get("font_size"), FONT_SIZE_PT["medium"])
        axis_font_size = label_font_size - 1
        base_color = _resolve_bar_color(style)
        opacity = style.get("opacity", 1.0)
        # opacity is applied via colors.Color's alpha channel -- corner_radius
        # has no equivalent in reportlab's bar-chart API, so it's not applied
        # here (chat-preview-only, same documented gap as the trend line).
        r, g, b = (int(base_color[i:i + 2], 16) / 255 for i in (0, 2, 4))
        line_color = colors.Color(r, g, b, alpha=opacity)
        trend_color = colors.HexColor(f"#{_TREND_LINE_COLOR_HEX}")
        has_trend = bool(trend_values) and len(trend_values) == len(values)

        if style.get("title"):
            elements.append(Paragraph(style["title"], styles["Heading3"]))
            elements.append(Spacer(1, 6))

        drawing = Drawing(440, 260)
        if style.get("chart_type") == "line":
            plot = LinePlot()
            plot.x, plot.y = 50, 50
            plot.width, plot.height = 180, 140
            plot.data = [[(i, v) for i, v in enumerate(values)]]
            plot.lines[0].strokeColor = line_color
            plot.lines[0].strokeWidth = 2
            if style.get("show_data_points"):
                plot.lines[0].symbol = makeMarker("Circle")
            if has_trend:
                # LinePlot natively supports multiple data series -- much
                # simpler than the bar case below, no manual coordinates
                # needed.
                plot.data.append([(i, v) for i, v in enumerate(trend_values)])
                plot.lines[1].strokeColor = trend_color
                plot.lines[1].strokeWidth = 1.5
                plot.lines[1].strokeDashArray = [4, 2]
            plot.xValueAxis.valueMin = 0
            plot.xValueAxis.valueMax = max(len(values) - 1, 0)
            plot.xValueAxis.valueSteps = list(range(len(values)))
            plot.xValueAxis.labelTextFormat = (
                lambda x, _cats=categories: str(_cats[int(x)]) if 0 <= int(x) < len(_cats) else ""
            )
            plot.xValueAxis.labels.fontSize = axis_font_size
            plot.xValueAxis.labels.angle = 30
            plot.xValueAxis.labels.dy = -10
            if style.get("show_gridlines"):
                plot.yValueAxis.visibleGrid = 1
                plot.yValueAxis.gridStrokeColor = colors.lightgrey
            # show_value_labels isn't applied here -- reportlab's LinePlot has
            # no equivalent of VerticalBarChart's barLabelFormat, only bar
            # charts get value labels in this export today.
            drawing = Drawing(440, 220)
            if style.get("y_axis_label"):
                drawing.add(String(15, 205, style["y_axis_label"], fontSize=axis_font_size))
            drawing.add(plot)
        else:
            bar = VerticalBarChart()
            bar.x, bar.y = 50, 50
            bar.width, bar.height = 360, 180
            bar.data = [values]
            bar.categoryAxis.categoryNames = [str(c) for c in categories]
            bar.categoryAxis.labels.angle = 30
            bar.categoryAxis.labels.dy = -10
            bar.categoryAxis.labels.fontSize = axis_font_size
            bar.valueAxis.valueMin = 0
            if has_trend:
                # VerticalBarChart has no native way to overlay a second
                # series -- explicitly set valueMax (rather than reportlab's
                # own auto-scaling, which isn't readable back before
                # drawing) so the bars and the manually-positioned trend
                # line below share one known scale. Verified this positions
                # correctly against the bars' own coordinate space.
                bar.valueAxis.valueMax = max(values + trend_values) * 1.15
            bar.bars[0].fillColor = line_color
            if style.get("show_gridlines"):
                bar.valueAxis.visibleGrid = 1
                bar.valueAxis.gridStrokeColor = colors.lightgrey
            if style.get("show_value_labels"):
                bar.barLabelFormat = label_format
                bar.barLabels.nudge = 7
                bar.barLabels.fontSize = label_font_size
            if style.get("y_axis_label"):
                drawing.add(String(15, 245, style["y_axis_label"], fontSize=axis_font_size))
            drawing.add(bar)
            if has_trend:
                n = len(values)
                slot_width = bar.width / n
                points = []
                for i, v in enumerate(trend_values):
                    x = bar.x + (i + 0.5) * slot_width
                    y = bar.y + (v / bar.valueAxis.valueMax) * bar.height
                    points.extend([x, y])
                drawing.add(PolyLine(points, strokeColor=trend_color, strokeWidth=1.5, strokeDashArray=[4, 2]))
        elements.append(drawing)
    elif chart.get("has_table"):
        table_data = [chart["table_columns"]] + chart["table_rows"]
        table = Table(table_data)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _AIRE_BRAND_COLOR),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
        ]))
        elements.append(table)

    doc.build(elements)
    return buf.getvalue()


def _build_excel(answer_text: str, chart: dict, chart_style: dict | None = None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"

    ws["A1"] = "AireOS Report"
    ws["A1"].font = XlsxFont(bold=True, size=14)
    ws["A2"] = datetime.date.today().strftime("%B %d, %Y")
    ws["A3"] = answer_text
    ws.merge_cells("A3:D3")
    ws.row_dimensions[3].height = 30
    ws["A3"].alignment = XlsxAlignment(wrap_text=True)

    if chart.get("has_chart"):
        categories = chart["chart_categories"]
        values = chart["chart_series"][0]["values"]
        header_row = 5
        ws.cell(row=header_row, column=1, value="Period")
        ws.cell(row=header_row, column=2, value=chart["chart_series"][0]["label"])
        for i, (category, value) in enumerate(zip(categories, values)):
            ws.cell(row=header_row + 1 + i, column=1, value=str(category))
            ws.cell(row=header_row + 1 + i, column=2, value=value)

        xlsx_chart = XlsxBarChart()
        xlsx_chart.title = "Revenue"
        last_row = header_row + len(categories)
        data_ref = Reference(ws, min_col=2, min_row=header_row, max_row=last_row)
        cats_ref = Reference(ws, min_col=1, min_row=header_row + 1, max_row=last_row)
        xlsx_chart.add_data(data_ref, titles_from_data=True)
        xlsx_chart.set_categories(cats_ref)
        ws.add_chart(xlsx_chart, f"D{header_row}")
    elif chart.get("has_table"):
        header_row = 5
        for col_idx, col_name in enumerate(chart["table_columns"], start=1):
            cell = ws.cell(row=header_row, column=col_idx, value=str(col_name))
            cell.font = XlsxFont(bold=True)
        for row_idx, row in enumerate(chart["table_rows"], start=header_row + 1):
            for col_idx, value in enumerate(row, start=1):
                ws.cell(row=row_idx, column=col_idx, value=value)

    for column_cells in ws.columns:
        length = max((len(str(cell.value)) for cell in column_cells if cell.value is not None), default=10)
        ws.column_dimensions[column_cells[0].column_letter].width = min(max(length + 2, 10), 40)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_MAX_BULLETS_PER_SLIDE = 4


def _chunk_points(points: list[str]) -> list[list[str]]:
    """Caps each slide at a readable number of bullets -- the system prompt
    already asks the model for 2-5 insights, but this is a defensive split
    (not a truncation) so a longer list still reads as several comfortable
    slides instead of one slide with tiny text."""
    return [points[i:i + _MAX_BULLETS_PER_SLIDE] for i in range(0, len(points), _MAX_BULLETS_PER_SLIDE)]


def _bullet_font_size(points: list[str]) -> Pt:
    """Scales down as bullets get more numerous/longer -- PowerPoint's
    default placeholder font (28pt) comfortably fits maybe one short bullet
    before overflowing the content box, which is exactly the overflow bug
    this was written to fix."""
    total_chars = sum(len(p) for p in points)
    if len(points) >= 4 or total_chars > 220:
        return Pt(15)
    if len(points) >= 3 or total_chars > 120:
        return Pt(18)
    return Pt(20)


_TREND_LINE_COLOR_HEX = "374151"


def _add_pptx_trend_line(pptx_chart, is_line_chart: bool, trend_values: list[float]) -> None:
    """
    python-pptx's public API can't build a bar+line combo chart (only a
    single chart type per graphic frame) and can't add a second series to
    an existing line chart either -- both require the standard OOXML
    technique of editing the chart's own XML directly: a combo chart is
    just a second <c:lineChart> sibling under the same <c:plotArea>,
    sharing the existing <c:axId> pair so it's drawn on the identical
    scale as the primary series; a second line series is just another
    <c:ser> inside the SAME <c:lineChart>. Verified round-trips correctly
    (re-opened, plotArea has two siblings, both series' values intact)
    before being wired in here.
    """
    plot_area = pptx_chart._chartSpace.chart.plotArea
    primary_tag = qn("c:lineChart") if is_line_chart else qn("c:barChart")
    primary_elm = plot_area.find(primary_tag)
    if primary_elm is None:
        return

    primary_ser = primary_elm.find(qn("c:ser"))
    cat_elm = copy.deepcopy(primary_ser.find(qn("c:cat")))
    cat_xml = etree.tostring(cat_elm).decode()
    pts_xml = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(trend_values))
    C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
    A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

    if is_line_chart:
        next_idx = len(primary_elm.findall(qn("c:ser")))
        ser_xml = f"""<c:ser xmlns:c="{C_NS}" xmlns:a="{A_NS}">
          <c:idx val="{next_idx}"/>
          <c:order val="{next_idx}"/>
          <c:tx><c:v>Trend</c:v></c:tx>
          <c:spPr>
            <a:ln w="19050">
              <a:solidFill><a:srgbClr val="{_TREND_LINE_COLOR_HEX}"/></a:solidFill>
              <a:prstDash val="dash"/>
            </a:ln>
          </c:spPr>
          <c:marker><c:symbol val="none"/></c:marker>
          {cat_xml}
          <c:val>
            <c:numRef>
              <c:numCache>
                <c:formatCode>General</c:formatCode>
                <c:ptCount val="{len(trend_values)}"/>
                {pts_xml}
              </c:numCache>
            </c:numRef>
          </c:val>
          <c:smooth val="0"/>
        </c:ser>"""
        primary_elm.append(etree.fromstring(ser_xml))
    else:
        ax_ids = [el.get("val") for el in primary_elm.findall(qn("c:axId"))]
        line_chart_xml = f"""<c:lineChart xmlns:c="{C_NS}" xmlns:a="{A_NS}">
          <c:grouping val="standard"/>
          <c:varyColors val="0"/>
          <c:ser>
            <c:idx val="1"/>
            <c:order val="1"/>
            <c:tx><c:v>Trend</c:v></c:tx>
            <c:spPr>
              <a:ln w="19050">
                <a:solidFill><a:srgbClr val="{_TREND_LINE_COLOR_HEX}"/></a:solidFill>
                <a:prstDash val="dash"/>
              </a:ln>
            </c:spPr>
            <c:marker><c:symbol val="none"/></c:marker>
            {cat_xml}
            <c:val>
              <c:numRef>
                <c:numCache>
                  <c:formatCode>General</c:formatCode>
                  <c:ptCount val="{len(trend_values)}"/>
                  {pts_xml}
                </c:numCache>
              </c:numRef>
            </c:val>
            <c:smooth val="0"/>
          </c:ser>
          <c:marker val="1"/>
          <c:axId val="{ax_ids[0]}"/>
          <c:axId val="{ax_ids[1]}"/>
        </c:lineChart>"""
        primary_elm.addnext(etree.fromstring(line_chart_xml))


def _build_pptx(answer_text: str, chart: dict, chart_style: dict | None = None, trend_values: list[float] | None = None) -> bytes:
    prs = Presentation()

    points = _split_into_points(answer_text)
    if points:
        # "Title and Content" layout -- its body placeholder auto-bullets
        # each paragraph, unlike the plain title slide's subtitle
        # placeholder, so multiple distinct insights read as a real list
        # rather than one run-on paragraph. Chunked across slides and
        # explicitly font-sized (rather than relying on the placeholder's
        # default 28pt) so a handful of full-sentence insights don't
        # overflow the slide -- auto_size is kept as a safety net on top,
        # for whatever the manual sizing still doesn't cover.
        chunks = _chunk_points(points)
        for chunk_index, chunk in enumerate(chunks):
            title_slide = prs.slides.add_slide(prs.slide_layouts[1])
            title_slide.shapes.title.text = (
                "AireOS Report" if len(chunks) == 1 else f"AireOS Report ({chunk_index + 1}/{len(chunks)})"
            )
            body = title_slide.placeholders[1].text_frame
            body.word_wrap = True
            body.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
            font_size = _bullet_font_size(chunk)
            body.text = chunk[0]
            body.paragraphs[0].font.size = font_size
            body.paragraphs[0].space_after = Pt(10)
            for point in chunk[1:]:
                paragraph = body.add_paragraph()
                paragraph.text = point
                paragraph.font.size = font_size
                paragraph.space_after = Pt(10)
    else:
        title_slide = prs.slides.add_slide(prs.slide_layouts[0])
        title_slide.shapes.title.text = "AireOS Report"
        title_slide.placeholders[1].text = answer_text

    if chart.get("has_chart"):
        style = chart_style or {}
        slide = prs.slides.add_slide(prs.slide_layouts[5])
        chart_data = CategoryChartData()
        chart_data.categories = [str(c) for c in chart["chart_categories"]]
        series = chart["chart_series"][0]
        chart_data.add_series(series["label"], series["values"])
        pptx_chart_type = XL_CHART_TYPE.LINE if style.get("chart_type") == "line" else XL_CHART_TYPE.COLUMN_CLUSTERED
        graphic_frame = slide.shapes.add_chart(
            pptx_chart_type, Inches(1), Inches(1.5), Inches(8), Inches(5), chart_data,
        )
        pptx_chart = graphic_frame.chart
        pptx_number_format = {"whole_number": "0", "currency": '"$"#,##0'}.get(style.get("value_label_format"), "0.00")
        label_font_size = FONT_SIZE_PT.get(style.get("font_size"), FONT_SIZE_PT["medium"])
        plot = pptx_chart.plots[0]
        plot.has_data_labels = bool(style.get("show_value_labels"))
        if plot.has_data_labels:
            plot.data_labels.number_format = pptx_number_format
            plot.data_labels.number_format_is_linked = False
            plot.data_labels.font.size = Pt(label_font_size)
        pptx_chart.value_axis.has_major_gridlines = bool(style.get("show_gridlines", True))
        pptx_chart.has_legend = bool(style.get("show_legend"))
        if style.get("title"):
            pptx_chart.has_title = True
            pptx_chart.chart_title.text_frame.text = style["title"]
        if style.get("y_axis_label"):
            pptx_chart.value_axis.has_title = True
            pptx_chart.value_axis.axis_title.text_frame.text = style["y_axis_label"]

        chart_series = pptx_chart.series[0]
        color_hex = _resolve_bar_color(style)
        # opacity has no equivalent in python-pptx 1.0.2's FillFormat (no
        # transparency property at all -- confirmed against the class, not
        # guessed) so it's not applied here, chat-preview/PDF only.
        if style.get("chart_type") == "line":
            chart_series.format.line.color.rgb = RGBColor.from_string(color_hex)
            if style.get("show_data_points"):
                chart_series.marker.style = XL_MARKER_STYLE.CIRCLE
                chart_series.marker.size = 7
        else:
            chart_series.format.fill.solid()
            chart_series.format.fill.fore_color.rgb = RGBColor.from_string(color_hex)

        if trend_values and len(trend_values) == len(series["values"]):
            _add_pptx_trend_line(pptx_chart, style.get("chart_type") == "line", trend_values)
    elif chart.get("has_table"):
        slide = prs.slides.add_slide(prs.slide_layouts[5])
        columns = chart["table_columns"]
        rows_data = chart["table_rows"]
        table_shape = slide.shapes.add_table(
            len(rows_data) + 1, len(columns), Inches(0.5), Inches(1.5), Inches(9), Inches(5),
        )
        table = table_shape.table
        for col_idx, col_name in enumerate(columns):
            table.cell(0, col_idx).text = str(col_name)
        for row_idx, row in enumerate(rows_data, start=1):
            for col_idx, value in enumerate(row):
                table.cell(row_idx, col_idx).text = str(value)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def generate_export_file(
    export_format: str,
    answer_text: str,
    chart: dict,
    chart_style: dict | None = None,
    trend_values: list[float] | None = None,
) -> tuple[bytes, str, str]:
    """
    Public entry point (unlike the _build_* builders): used both by
    _build_download below (the model-driven export_format path, embedded
    as base64 in the chat response) and directly by the router's stateless
    /export endpoint (the always-available PDF/PowerPoint button, which returns
    the file as the HTTP response body instead). Raises ValueError for an
    unsupported format, or whatever the underlying builder raises on a
    genuine generation failure -- callers decide how to handle that.

    trend_values is only used by pdf/pptx (a real overlay in both, not just
    a documented gap anymore); excel has no chat-facing style button so
    chart_style/trend_values are both ignored there.
    """
    if export_format == "pdf":
        return _build_pdf(answer_text, chart, chart_style, trend_values), "application/pdf", "aireos-report.pdf"
    if export_format == "excel":
        return (
            _build_excel(answer_text, chart, chart_style),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "aireos-report.xlsx",
        )
    if export_format == "pptx":
        return (
            _build_pptx(answer_text, chart, chart_style, trend_values),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "aireos-report.pptx",
        )
    raise ValueError(f"Unsupported export format: {export_format}")


def _build_download(
    export_format: str,
    answer_text: str,
    chart: dict,
    chart_style: dict | None = None,
    trend_values: list[float] | None = None,
) -> dict:
    if export_format not in ("pdf", "pptx", "excel"):
        return _empty_download()

    try:
        file_bytes, mime_type, filename = generate_export_file(export_format, answer_text, chart, chart_style, trend_values)
    except Exception:
        return _empty_download()

    return {
        "has_download": True,
        "download_filename": filename,
        "download_mime_type": mime_type,
        "download_base64": base64.b64encode(file_bytes).decode("ascii"),
    }


# ---- Numeric grounding safeguard -------------------------------------------
#
# Belt-and-suspenders on top of the chart-building guarantee above: the
# chart can never cite a wrong number (it's built purely from tool data),
# but the *text* still goes through the model, which can occasionally slip
# on arithmetic even with every input number correct (observed live: a
# multi-month total came out ~$400 off with no reproducible cause). This
# doesn't try to catch every number in the answer -- deltas and percentages
# are legitimate derived arithmetic, not verbatim tool output, and checking
# those invites false positives. It only checks the FIRST dollar figure,
# since that's consistently the headline total/figure the question was
# actually asking for.

_DOLLAR_FIGURE_RE = re.compile(r"\$\s?([\d,]+\.\d{2})")


def _first_dollar_figure(text: str) -> float | None:
    match = _DOLLAR_FIGURE_RE.search(text or "")
    return float(match.group(1).replace(",", "")) if match else None


def _known_good_revenue_figures(chart: dict, chart_sources: list[tuple[str, dict, object]]) -> set[float]:
    """Every revenue figure that actually came back from a tool call this
    turn (rounded to cents) -- what the headline figure must be one of."""
    figures: set[float] = set()
    for series in chart.get("chart_series") or []:
        for value in series.get("values", []):
            figures.add(round(float(value), 2))
    for name, _tool_input, raw in chart_sources:
        if name == "compare_periods":
            for side in ("current", "previous"):
                revenue = (raw.get(side) or {}).get("revenue")
                if revenue is not None:
                    figures.add(round(float(revenue), 2))
        elif name == "get_sales_summary":
            for mode_data in (raw.get("offline"), raw.get("online")):
                for row in (mode_data or {}).get("periodTotal") or []:
                    figures.add(round(float(row["revenue"]), 2))
        elif name == "rank_skus":
            for row in raw or []:
                if row.get("value") is not None:
                    figures.add(round(float(row["value"]), 2))
    return figures


def _verify_and_maybe_correct(
    client: "genai.Client",
    contents: list,
    config: "types.GenerateContentConfig",
    parsed: dict,
    chart: dict,
    chart_sources: list[tuple[str, dict, object]],
) -> dict:
    """
    If the answer's headline dollar figure doesn't match anything the tools
    actually returned, ask the model to restate it once -- pointing out
    exactly which figures are verified -- rather than silently shipping a
    number that isn't grounded. Only applies to internal-data answers; a
    market_data answer's figures come from search results, not chart_sources,
    so there's nothing here to check them against.
    """
    if parsed.get("data_source") != "aire_data" or not parsed.get("grounded"):
        return parsed

    headline = _first_dollar_figure(parsed.get("answer", ""))
    if headline is None:
        return parsed

    known_good = _known_good_revenue_figures(chart, chart_sources)
    if not known_good or headline in known_good:
        return parsed

    contents.append({
        "role": "user",
        "parts": [{"text": (
            f"Your answer states ${headline:,.2f}, which doesn't match any figure the "
            f"tools actually returned. The verified figures from this turn's tool "
            f"results are: {', '.join(f'${v:,.2f}' for v in sorted(known_good))}. "
            "Restate your final answer using one of these exact figures."
        )}],
    })
    try:
        retry_response = client.models.generate_content(model=MODEL, contents=contents, config=config)
    except genai_errors.APIError:
        return parsed
    retry_candidate = retry_response.candidates[0]
    if retry_candidate.finish_reason in _REFUSAL_FINISH_REASONS:
        return parsed
    contents.append(retry_candidate.content)
    try:
        retry_parsed = json.loads(retry_response.text)
    except (json.JSONDecodeError, TypeError):
        return parsed

    # Only accept the retry if it actually verifies now -- otherwise the
    # original (at least consistently wrong) answer is no worse a bet.
    retry_headline = _first_dollar_figure(retry_parsed.get("answer", ""))
    if retry_headline is not None and retry_headline in known_good:
        return retry_parsed
    return parsed


# ---- Final structured answer ---------------------------------------------

FINAL_ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "description": "The natural-language answer to show the user."},
        "grounded": {"type": "boolean", "description": "False if this question could not be answered from the available tools, OR if this is an analysis/opinion answer (data_source=\"analysis\") -- in the former case 'answer' must say so plainly instead of guessing; in the latter it's the model's own reasoning, not a failure."},
        "data_source": {"type": "string", "enum": ["aire_data", "market_data", "both", "analysis", "none"], "description": "\"analysis\" for reasons/explanations/suggestions/recommendations the model is offering as its own judgment rather than something a tool verified."},
        "follow_up_prompts": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Exactly 2 or 3 short, contextual follow-up questions the user might ask next.",
        },
        "export_format": {
            "type": "string",
            "enum": ["none", "pdf", "pptx", "excel"],
            "description": "\"pdf\"/\"excel\"/\"pptx\" if this message asks for a downloadable report/spreadsheet/presentation of the answer; \"none\" otherwise. Note: PDF and Excel are also always available via a button under every answer with a chart/table, without needing to ask.",
        },
        "chart_style": {
            "type": "object",
            "properties": {
                "color": {
                    "type": "string",
                    "description": "'default' to use AireOS's brand color, or a specific #RRGGBB hex code when the user names a color (map color names to hex yourself, e.g. red->#DC2626, blue->#2563EB, green->#16A34A). Keep the CURRENT color (given in the system prompt) unless this message explicitly asks to change it.",
                },
                "show_value_labels": {
                    "type": "boolean",
                    "description": "Whether to show the numeric value above each bar/point. Keep the CURRENT value (given in the system prompt) unless this message explicitly asks to change it.",
                },
                "value_label_format": {
                    "type": "string",
                    "enum": ["auto", "whole_number", "decimal", "currency"],
                    "description": "How to format value labels: 'whole_number' rounds to an integer (e.g. user asks to remove decimals/round the numbers), 'decimal' always shows 2 decimal places, 'currency' prefixes with $ (e.g. user asks to show it as dollars), 'auto' (default) leaves the number as-is. Keep the CURRENT value unless explicitly asked to change it.",
                },
                "show_trend_line": {
                    "type": "boolean",
                    "description": "Whether to overlay a trend line on the chart. Keep the CURRENT value (given in the system prompt) unless this message explicitly asks to change it.",
                },
                "show_gridlines": {
                    "type": "boolean",
                    "description": "Whether to show background gridlines (default true). Keep the CURRENT value unless explicitly asked to change it.",
                },
                "chart_type": {
                    "type": "string",
                    "enum": ["auto", "bar", "line"],
                    "description": "'auto' (default) keeps whatever chart type the data naturally produced. 'bar'/'line' switches how the SAME numbers are drawn when the user explicitly asks (e.g. \"show this as a line chart\") -- never changes the data. Keep the CURRENT value unless explicitly asked to change it.",
                },
                "title": {
                    "type": "string",
                    "description": "A short title to display above the chart, e.g. 'Past 4 Months'. Empty string means no title (default). Set this only when the user explicitly asks for a chart title/heading. Keep the CURRENT value unless explicitly asked to change it.",
                },
                "show_legend": {
                    "type": "boolean",
                    "description": "Whether to show a legend below/beside the chart (default false -- the chart only ever has one series, so a legend is rarely needed unless explicitly requested). Keep the CURRENT value unless explicitly asked to change it.",
                },
                "y_axis_label": {
                    "type": "string",
                    "description": "A short label for the value (y) axis, e.g. 'Revenue ($)'. Empty string means no label (default). Set only when explicitly asked to label the axis. Keep the CURRENT value unless explicitly asked to change it.",
                },
                "opacity": {
                    "type": "number",
                    "description": "Fill/line opacity from 0.3 (mostly transparent) to 1.0 (fully solid, default). Set only when the user explicitly asks for a transparent/faded/washed-out look. Keep the CURRENT value unless explicitly asked to change it.",
                },
                "corner_radius": {
                    "type": "integer",
                    "description": "Bar corner rounding in pixels, 0 (square, default) to 12 (very rounded). Only applies to bar charts. Set only when explicitly asked (e.g. 'round the corners', 'sharp corners'). Keep the CURRENT value unless explicitly asked to change it.",
                },
                "font_size": {
                    "type": "string",
                    "enum": ["small", "medium", "large"],
                    "description": "Overall text size for labels/axis ticks. 'medium' is the default. Set to 'small'/'large' only when the user explicitly asks to shrink/enlarge the text. Keep the CURRENT value unless explicitly asked to change it.",
                },
                "show_data_points": {
                    "type": "boolean",
                    "description": "Whether to show a marker/dot at each data point -- only meaningful when chart_type is 'line' (default false). Set only when explicitly asked (e.g. 'show the data points', 'add dots'). Keep the CURRENT value unless explicitly asked to change it.",
                },
            },
            "required": [
                "color", "show_value_labels", "value_label_format", "show_trend_line", "show_gridlines",
                "chart_type", "title", "show_legend", "y_axis_label", "opacity", "corner_radius",
                "font_size", "show_data_points",
            ],
            "additionalProperties": False,
            "description": "Presentation-only preferences for the chart currently on screen. Never a way to change the underlying numbers -- if there's no chart to style, say so in your answer instead of inventing one.",
        },
    },
    "required": ["answer", "grounded", "data_source", "follow_up_prompts", "export_format", "chart_style"],
    "additionalProperties": False,
}

_DEFAULT_CHART_STYLE = {
    "color": "default",
    "show_value_labels": False,
    "value_label_format": "auto",
    "show_trend_line": False,
    "show_gridlines": True,
    "chart_type": "auto",
    "title": "",
    "show_legend": False,
    "y_axis_label": "",
    "opacity": 1.0,
    "corner_radius": 4,
    "font_size": "medium",
    "show_data_points": False,
}

_MAX_CHART_TITLE_LENGTH = 80
_MAX_AXIS_LABEL_LENGTH = 40

_VALUE_LABEL_FORMATS = {"auto", "whole_number", "decimal", "currency"}
_CHART_TYPES = {"auto", "bar", "line"}
_FONT_SIZES = {"small", "medium", "large"}

# pt for reportlab/pptx, px for the frontend's Recharts tick/label style --
# shared here so every renderer maps the same tier to the same visual scale.
FONT_SIZE_PT = {"small": 6, "medium": 8, "large": 11}
FONT_SIZE_PX = {"small": 7, "medium": 9, "large": 12}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _sanitize_chart_style(raw: dict | None) -> dict:
    """
    Single validator for every chart_style field, used both for the incoming
    last_chart_style (what the frontend says is already on screen) and the
    model's own chart_style output -- neither is trusted as-is. Unknown/
    malformed values fall back to the safe default for that field rather
    than propagating a bad enum value into the renderers.
    """
    raw = raw or {}
    try:
        opacity = _clamp(float(raw.get("opacity", 1.0)), 0.3, 1.0)
    except (TypeError, ValueError):
        opacity = 1.0
    try:
        corner_radius = int(_clamp(float(raw.get("corner_radius", 4)), 0, 12))
    except (TypeError, ValueError):
        corner_radius = 4
    return {
        "color": _sanitize_color(raw.get("color")),
        "show_value_labels": bool(raw.get("show_value_labels", False)),
        "value_label_format": raw.get("value_label_format") if raw.get("value_label_format") in _VALUE_LABEL_FORMATS else "auto",
        "show_trend_line": bool(raw.get("show_trend_line", False)),
        "show_gridlines": bool(raw.get("show_gridlines", True)),
        "chart_type": raw.get("chart_type") if raw.get("chart_type") in _CHART_TYPES else "auto",
        "title": str(raw.get("title") or "").strip()[:_MAX_CHART_TITLE_LENGTH],
        "show_legend": bool(raw.get("show_legend", False)),
        "y_axis_label": str(raw.get("y_axis_label") or "").strip()[:_MAX_AXIS_LABEL_LENGTH],
        "opacity": opacity,
        "corner_radius": corner_radius,
        "font_size": raw.get("font_size") if raw.get("font_size") in _FONT_SIZES else "medium",
        "show_data_points": bool(raw.get("show_data_points", False)),
    }


def _system_prompt(current_style: dict) -> str:
    today = datetime.date.today().isoformat()
    style_desc = (
        f"color={current_style['color']}, show_value_labels={current_style['show_value_labels']}, "
        f"value_label_format={current_style['value_label_format']}, "
        f"show_trend_line={current_style['show_trend_line']}, "
        f"show_gridlines={current_style['show_gridlines']}, chart_type={current_style['chart_type']}, "
        f"title={current_style['title'] or '(none)'}, show_legend={current_style['show_legend']}, "
        f"y_axis_label={current_style['y_axis_label'] or '(none)'}, opacity={current_style['opacity']}, "
        f"corner_radius={current_style['corner_radius']}, font_size={current_style['font_size']}, "
        f"show_data_points={current_style['show_data_points']}"
    )
    return f"""You are a business-analytics assistant for AireOS staff. Today's date is {today}.

The chart currently on screen (if any) has this style: {style_desc}.

AireOS sells adult incontinence / hygiene care products (e.g. adult diaper
pants, tape-style diapers) through retail partners such as FairPrice. When a
question is about competitors, the market, or industry news, scope your
search specifically to the adult incontinence / hygiene care category --
never return results from unrelated industries (e.g. networking, IT,
consumer electronics) even if they rank highly in a generic search.

You have read-only tools over the company's own sales data (get_sales_summary,
compare_periods, rank_skus, and lookups to resolve names to exact IDs), a
separate promotions catalog (get_promotions -- retailer/store(s)/dates/type/
mechanic/SKUs for actual promotions run, no revenue figures), and Google
Search grounding for general market/competitor information.

Rules:
- Only state figures that came back from a tool call. Never estimate,
  guess, or use outside knowledge for anything a tool could have answered.
- Never manually add up multiple rows from get_sales_summary (or any other
  tool) to produce a single total -- that arithmetic is exactly where small
  mistakes creep in. If a question needs one total across a range spanning
  more than one period, use compare_periods with current_start/current_end
  set to that range and read current.revenue/current.units, which are
  computed server-side with SQL SUM(), not by you adding numbers together.
- If no tool call (internal or search) returned anything relevant to the
  question, say plainly in your answer that you don't have data to answer
  it -- do not fabricate a plausible-sounding number.
- Prefer the internal data tools for anything about AireOS's own sales,
  revenue, units, stores, or SKUs. Only search for genuinely external
  questions (market trends, competitors, general industry facts).
- If the user explicitly asks for REASONS something happened, or for
  SUGGESTIONS/RECOMMENDATIONS/next steps/your opinion -- not a specific
  number or fact -- you may answer using your own business reasoning
  instead of refusing. Set data_source="analysis" and grounded=false; this
  is intentional, not a failure, and signals the answer is interpretation/
  judgment rather than verified data. Don't default to this mode for
  questions a tool could actually answer.
  BEFORE reasoning, call the relevant data tool(s) first (get_sales_summary/
  compare_periods for the trend shape over the period in question, rank_skus
  for what's driving it, get_promotions for the SAME date range to check
  whether an actual promotion explains a spike or dip) so you can see what
  ACTUALLY happened -- which weeks/months were notably higher or lower than
  the rest, which SKUs or channels moved the most, whether a real promotion
  was running. Anchor every insight to one of those specific, observed data
  points (e.g. "the spike in April lines up with a 20% off promotion at
  FairPrice that month" -- a real get_promotions result, not a guess; or
  "the dip in Week 21 lines up with Widget A's volume dropping 40% that
  week") instead of a generic list of possible causes ("seasonality,
  economic conditions") that could apply to any business and isn't
  actually tied to what the data shows. If get_promotions found nothing
  for that period, say so plainly rather than still guessing a promotion
  might have happened. If you genuinely can't find a data-backed pattern
  to explain something, say that plainly rather than filling the gap with
  boilerplate reasoning.
- Keep your answer concise -- it's for a business user skimming on their
  phone, not an analyst reading a report: 1-3 sentences, no bullet lists,
  no exhaustive breakdowns. Lead with the single number/insight that
  actually answers the question, plus at most one supporting comparison
  (e.g. vs last period, or the single biggest driver). Do not enumerate
  every store format, channel, or sub-category in prose -- that level of
  detail belongs in the chart/table the user already sees alongside your
  answer, not repeated in text. If you're unsure whether a number earns a
  place in your answer, leave it out.
  EXCEPTION: for an analysis-mode answer (data_source="analysis"), this
  conciseness limit doesn't apply. If it covers 2 or more distinct insights
  or suggestions, you MUST format it as one short bullet line per insight,
  each starting with "- " on its own line -- never merge multiple distinct
  insights into one paragraph, even in the chat window, since this content
  is often exported into a report/slide where each point needs to stand on
  its own. Use as many bullets as are genuinely distinct and data-backed
  (typically 2-5). A single, simple analysis question with only one
  insight can still just be answered in a sentence or two, no bullet
  needed.
- Set export_format to "pdf"/"pptx"/"excel" when the current message
  explicitly asks for a downloadable report/presentation/spreadsheet (e.g.
  "export this as PDF", "make a slide for this"); "none" for every other
  message -- PDF/PowerPoint are already offered as a button under every
  answer, so this is only for explicit requests (including excel, which
  has no button) or ones phrased as a question rather than a button click.
  If this is a follow-up asking to export an earlier answer, re-fetch the relevant
  data tool again first if you can, so the export includes a chart rather
  than just text.
- Set chart_style to describe how the chart should look after this message.
  Only change a field the user explicitly asked to change this message
  (e.g. "make it red" changes color only; "add a trend line" changes
  show_trend_line only) -- otherwise keep the CURRENT values given above
  exactly as they are, so a style choice persists across turns instead of
  resetting. This never changes the actual data plotted -- if the user asks
  to style a chart that isn't there (nothing charted yet, or this question
  didn't produce one), say so in your answer rather than guessing a chart
  into existence.
"""


# Gemini finish_reasons that mean the model declined to answer (safety
# filters, blocked content, etc.)
_REFUSAL_FINISH_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"}

_REFUSAL_ANSWER = {
    "answer": "I'm not able to answer that question.",
    "grounded": False,
    "data_source": "none",
    "follow_up_prompts": [],
}


def _serialize_contents(contents: list) -> list[dict]:
    """types.Content objects (produced during this turn) -> plain dicts, so
    the response is JSON-serializable and the caller can replay it verbatim
    as `history` next turn (the SDK accepts plain dicts as input directly,
    no reconstruction needed on the way back in)."""
    return [c.model_dump(exclude_none=True, mode="json") if hasattr(c, "model_dump") else c for c in contents]


# ---- "What's changed?" digest -----------------------------------------------

_DIGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "description": "The natural-language summary to show the user."},
        "follow_up_prompts": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Exactly 2 or 3 short, contextual follow-up questions the user might ask next.",
        },
    },
    "required": ["answer", "follow_up_prompts"],
    "additionalProperties": False,
}


def _digest_system_prompt() -> str:
    return """You are summarizing a fixed set of ALREADY-VERIFIED facts about AireOS's
business (adult incontinence / hygiene care products) for a busy manager
skimming on their phone.

Rules:
- State ONLY the figures/facts given in the message below -- never estimate,
  guess, or add a number that isn't there.
- One short bullet line per fact, each starting with "- ". 2-4 bullets total.
  Lead each bullet with the headline number/fact, not a preamble.
- If a section says there's nothing notable, skip that bullet entirely
  rather than forcing a mention of "nothing changed."
- No greeting, no closing sentence -- just the bullets.
"""


def _digest_facts_text(trend: dict, movers: list[dict], upcoming_promotions: list[dict]) -> str:
    lines = ["Summarize these already-verified facts for the user:"]

    current, previous = trend.get("current") or {}, trend.get("previous") or {}
    if current.get("start") and previous.get("available"):
        lines.append(
            f"- Revenue trend: {current['start']} to {current['end']} was ${current['revenue']:,.2f}, "
            f"vs {previous['start']} to {previous['end']}'s ${previous['revenue']:,.2f}."
        )
    else:
        lines.append("- Revenue trend: not enough data yet to compare this week to last week.")

    if movers:
        lines.append("- Biggest SKU rank movers this week vs last week:")
        for m in movers:
            direction = "up" if m["delta"] > 0 else "down"
            lines.append(
                f"  - {m['product_name']} ({m['sku']}) moved {direction}, "
                f"rank {m['previous_rank']} -> {m['current_rank']}."
            )
    else:
        lines.append("- No notable SKU rank changes this week vs last week.")

    if upcoming_promotions:
        lines.append("- Promotions starting or ending within the next 7 days:")
        for p in upcoming_promotions:
            stores = ", ".join(f"{s['retailer']} - {s['store_name']}" for s in p.get("stores") or [])
            lines.append(
                f"  - {p.get('period_label')} ({p.get('promo_type')}, {p.get('promotion_mechanic')}) "
                f"at {stores}: {p.get('period_start')} to {p.get('period_end')}."
            )
    else:
        lines.append("- No promotions starting or ending in the next 7 days.")

    return "\n".join(lines)


def generate_digest(customer: str) -> dict:
    """
    Deterministic "what's changed" summary -- see the module comment above
    this section for why this deliberately has no tool-calling loop. Returns
    the same response shape ask() does, so it becomes valid `history` for a
    natural follow-up question in the same conversation, and the frontend
    renders it with the components it already has.
    """
    client = get_client()

    trend = bigquery.get_period_comparison(comparison_type="wow", customer=customer)
    trend_chart = _build_chart([("compare_periods", {"comparison_type": "wow"}, trend)], customer)

    movers: list[dict] = []
    current, previous = trend.get("current") or {}, trend.get("previous") or {}
    if current.get("start") and previous.get("start"):
        current_ranks = bigquery.get_sku_ranking(
            customer=customer, start_date=current["start"], end_date=current["end"]
        ).to_dict(orient="records")
        previous_ranks = bigquery.get_sku_ranking(
            customer=customer, start_date=previous["start"], end_date=previous["end"]
        ).to_dict(orient="records")
        movers = _rank_movers(current_ranks, previous_ranks)

    try:
        promotions = promotion_service.get_promotions()
        upcoming_promotions = _promotions_starting_or_ending_soon(promotions, customer)
    except Exception:
        upcoming_promotions = []

    contents: list = [{"role": "user", "parts": [{"text": _digest_facts_text(trend, movers, upcoming_promotions)}]}]
    config = types.GenerateContentConfig(
        system_instruction=_digest_system_prompt(),
        response_mime_type="application/json",
        response_json_schema=_DIGEST_SCHEMA,
    )
    response = client.models.generate_content(model=MODEL, contents=contents, config=config)
    candidate = response.candidates[0]
    contents.append(candidate.content)

    if candidate.finish_reason in _REFUSAL_FINISH_REASONS:
        parsed = {"answer": "Here's what's changed, though I couldn't fully summarize it this time.", "follow_up_prompts": []}
    else:
        try:
            parsed = json.loads(response.text)
        except (json.JSONDecodeError, TypeError):
            parsed = {"answer": "Here's what's changed, though I couldn't fully summarize it this time.", "follow_up_prompts": []}

    return {
        "answer": parsed.get("answer", ""),
        "grounded": True,
        "data_source": "aire_data",
        "follow_up_prompts": parsed.get("follow_up_prompts") or [],
        "export_format": "none",
        "chart_style": dict(_DEFAULT_CHART_STYLE),
        **trend_chart,
        "chart_trend_values": [],
        **_empty_download(),
        "messages": _serialize_contents(contents),
    }


def ask(
    question: str,
    history: list[dict] | None,
    customer: str,
    last_chart: dict | None = None,
    last_chart_style: dict | None = None,
) -> dict:
    """
    Runs the agentic loop for one question and returns:
    {answer, grounded, data_source, follow_up_prompts, chart, table,
     messages}  -- `messages` is the updated history the caller should send
    back on the next turn for multi-turn memory.

    `tools` and the structured-output schema are both set on every call --
    nothing in this SDK's own config surface (inspected directly:
    GenerateContentConfig accepts `tools` and `response_json_schema` as
    independent fields with no stated exclusivity) suggested they can't
    coexist, and combining them is what the Anthropic version did
    successfully. The business-tools loop runs first; Google Search is
    tried as a second pass only if that couldn't answer (grounded=false)
    -- confirmed live that Gemini rejects mixing function-declaration tools
    with search tools in the same request, so they can never both be
    active in one call.
    """
    client = get_client()
    contents: list = list(history or [])
    contents.append({"role": "user", "parts": [{"text": question}]})

    chart_sources: list[tuple[str, dict, object]] = []
    resolved_input_style = _sanitize_chart_style(last_chart_style) if last_chart_style else _DEFAULT_CHART_STYLE
    system_instruction = _system_prompt(resolved_input_style)
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        tools=_BUSINESS_TOOLS,
        response_mime_type="application/json",
        response_json_schema=FINAL_ANSWER_SCHEMA,
    )

    response = None
    for _ in range(MAX_TOOL_ITERATIONS):
        response = client.models.generate_content(model=MODEL, contents=contents, config=config)
        candidate = response.candidates[0]
        contents.append(candidate.content)

        if candidate.finish_reason in _REFUSAL_FINISH_REASONS:
            return {**_REFUSAL_ANSWER, **_empty_chart(), "messages": _serialize_contents(contents)}

        function_calls = response.function_calls or []
        if not function_calls:
            break

        response_parts = []
        for fc in function_calls:
            content, is_error, raw_result = _run_business_tool(fc.name, fc.args or {}, customer)
            if not is_error and fc.name in _CHARTABLE_TOOLS and raw_result is not None:
                chart_sources.append((fc.name, fc.args or {}, raw_result))
            response_parts.append(
                types.Part.from_function_response(
                    name=fc.name,
                    response={"error": content} if is_error else {"result": content},
                )
            )
        contents.append(types.Content(role="user", parts=response_parts))
    else:
        raise AssistantLoopError(f"No final answer after {MAX_TOOL_ITERATIONS} tool iterations")

    parsed = json.loads(response.text)

    if not parsed.get("grounded", True) and parsed.get("data_source") != "analysis":
        # data_source="analysis" is deliberately ungrounded (the model
        # chose to answer with its own reasoning, not a failure to find
        # data) -- it must not trigger the "couldn't find data, try
        # searching" fallback below, which is only for genuine data
        # lookups that came up empty. Confirmed live: response_json_schema
        # cannot be combined with the search tool either ("controlled
        # generation is not supported with Search tool")
        search_config = types.GenerateContentConfig(system_instruction=system_instruction, tools=_SEARCH_TOOLS)
        contents.append({"role": "user", "parts": [{"text": "The business data tools couldn't answer that. Try searching the web instead."}]})
        search_response = client.models.generate_content(model=MODEL, contents=contents, config=search_config)
        search_candidate = search_response.candidates[0]

        if search_candidate.finish_reason not in _REFUSAL_FINISH_REASONS and search_response.text:
            contents.append(search_candidate.content)
            contents.append({"role": "user", "parts": [{"text": "Give your final answer now, following the schema, based on the search results above."}]})
            reshape_config = types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_json_schema=FINAL_ANSWER_SCHEMA,
            )
            reshape_response = client.models.generate_content(model=MODEL, contents=contents, config=reshape_config)
            reshape_candidate = reshape_response.candidates[0]
            if reshape_candidate.finish_reason not in _REFUSAL_FINISH_REASONS:
                contents.append(reshape_candidate.content)
                reshaped = json.loads(reshape_response.text)
                if reshaped.get("grounded"):
                    parsed = reshaped

    chart = _build_chart(chart_sources, customer)
    parsed = _verify_and_maybe_correct(client, contents, config, parsed, chart, chart_sources)

    # Carrying forward the previous chart is only correct when this turn's
    # answer is actually about that context (a styling tweak, "why is
    # that") -- an off-topic refusal ("what should I eat for lunch") also
    # makes no tool call, but has nothing to do with the old chart, so
    # showing it there would be actively misleading rather than helpful.
    if parsed.get("data_source") != "none":
        chart = _resolve_last_chart(chart, last_chart)

    chart_style = _sanitize_chart_style(parsed.get("chart_style"))
    chart = _resolve_chart_type(chart, chart_style)
    trend_values: list[float] = []
    if chart_style["show_trend_line"] and chart.get("chart_series"):
        trend_values = _linear_trend(chart["chart_series"][0]["values"])

    download = _build_download(parsed.get("export_format", "none"), parsed["answer"], chart, chart_style, trend_values)

    return {
        **parsed,
        **chart,
        "chart_style": chart_style,
        "chart_trend_values": trend_values,
        **download,
        "messages": _serialize_contents(contents),
    }
