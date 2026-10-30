"""
What a file's columns look like, worked out from the whole file.

Three things the mapping step needs and none of them needs the model:

  - a profile of every column over every row (type, blanks, distinct values,
    range, share negative), so the proposal is made from the file and not
    from its first five rows
  - the repeated column groups: one metric per period ("SALES | Month 3 |
    01-03-2026") or one column per store code ("2A", "6M_Ecomm", ...)
  - a fingerprint of the layout that ignores what changes from one month's
    file to the next -- the dates in the headers, an extra outlet column -- so
    next month's file reuses the contract confirmed for this one

Pure: pandas in, plain dicts out.
"""

import hashlib
import re

import pandas as pd

# A date inside a header: 01-08-2026, 2026-08-01, 1/8/26.
DATE_TOKEN = re.compile(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}")
MONTH_NAME = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b",
    re.IGNORECASE,
)
# A short store/outlet code used as a column header: "2A", "KL", "6M_Ecomm".
CODE_HEADER = re.compile(r"^[A-Z0-9]{1,4}(?:_[A-Za-z]+)?$")
# Fewer adjacent code headers than this is a coincidence, not a store crosstab.
MIN_DIMENSION_RUN = 3

# Tried in this order; the first that reads every header in a group wins.
# Day-first comes first because the retailers are Singaporean: "01-08-2026"
# parses both ways, and it means 1 August.
HEADER_DATE_FORMATS = ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y", "%m-%d-%Y", "%m/%d/%Y")

# A column with this few distinct values is listed in full, so a rule mapping
# its codes (Store Format FPON -> online) can be checked against every value.
FULL_LIST_LIMIT = 12
SPREAD_SIZE = 8


def to_snake_case(col: str) -> str:
    s = str(col).strip().lower()
    s = s.replace("|", " ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"[\s_]+", "_", s)
    return s.strip("_")


def header_template(header: str) -> str:
    """
    A header with its dates and numbers generalised away.

    "SALES | Month 3 | 01-03-2026" and "SALES | Month 1 | 01-02-2026" both read
    "sales_month_n_n_n_n": the same metric for a different month. Snake-cased
    first, so "sales_month_1_01_03_2026" reads the same too.
    """
    text = to_snake_case(MONTH_NAME.sub(" month_name ", str(header)))
    return re.sub(r"\d+", "n", text)


# ---- Repeated column groups ---------------------------------------------------

def _guess_date_format(keys: list[str]) -> str | None:
    for date_format in HEADER_DATE_FORMATS:
        parsed = pd.to_datetime(pd.Series(keys), format=date_format, errors="coerce")
        if parsed.notna().all():
            return date_format
    return None


def _period_pattern(header: str) -> tuple[str, str]:
    """
    A selector pattern and a key pattern for one period column's header.

    The selector matches every column of the group (numbers generalised); the
    key pattern captures the date out of each.
    """
    def generalise(text: str) -> str:
        return re.sub(r"\d+", r"\\d+", re.escape(text))

    date = DATE_TOKEN.search(header)
    before = generalise(header[: date.start()])
    after = generalise(header[date.end() :])
    date_pattern = r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}"
    return (
        f"^{before}{date_pattern}{after}$",
        f"{before}({date_pattern}){after}$",
    )


def detect_column_groups(columns: list[str]) -> list[dict]:
    """
    Columns that repeat one metric across periods, and runs of store-code
    columns.

    A period group is two or more headers sharing a template and carrying a
    date ("SALES | Month n | <date>"); each comes with a suggested selector
    pattern, key pattern and date format. A dimension group is a run of at
    least MIN_DIMENSION_RUN adjacent short code headers ("2A", "6M_Ecomm",
    ...), with the columns either side of it so it can be selected as
    "everything between OUTLET and Total" and still pick up an outlet added
    next month.
    """
    groups: list[dict] = []

    by_template: dict[str, list[str]] = {}
    for column in columns:
        if DATE_TOKEN.search(column):
            by_template.setdefault(header_template(column), []).append(column)

    for template, members in by_template.items():
        if len(members) < 2:
            continue
        select_pattern, key_pattern = _period_pattern(members[0])
        keys = [re.search(key_pattern, column).group(1) for column in members if re.search(key_pattern, column)]
        groups.append({
            "kind": "period",
            "template": template,
            "columns": members,
            "select_pattern": select_pattern,
            "key_pattern": key_pattern,
            "date_format": _guess_date_format(keys) if len(keys) == len(members) else None,
            "period_type": (
                "month" if "month" in template else "week" if "week" in template else None
            ),
        })

    run: list[int] = []
    for index, column in enumerate([*columns, ""]):
        if column and CODE_HEADER.match(column):
            run.append(index)
            continue
        # Abbreviated headers (SKU, UOM, MCH) also look like codes; a run of
        # store codes has digits in it somewhere ("2A", "6T", "B1").
        has_digit = any(any(ch.isdigit() for ch in columns[i]) for i in run)
        if len(run) >= MIN_DIMENSION_RUN and has_digit:
            groups.append({
                "kind": "dimension",
                "columns": [columns[i] for i in run],
                "after": columns[run[0] - 1] if run[0] > 0 else None,
                "before": columns[run[-1] + 1] if run[-1] + 1 < len(columns) else None,
            })
        run = []

    return groups


# ---- Groups the review screen offers ---------------------------------------------

# A month named in a header with its year: "Jan 2026", "January-26", "2026 Jan".
# Not part of detect_column_groups, which the fingerprint is built from: adding
# a group there would change the fingerprint of every layout with such headers
# and orphan the mappings confirmed for them.
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
MONTH_YEAR_TOKEN = re.compile(rf"(?i)\b(?:{_MONTH}[\s\-'/.]*\d{{2,4}}|\d{{4}}[\s\-/.]*{_MONTH})\b")
# Month first before year first, the way the retailers write them; the first
# format that reads every header in a group wins.
_MONTH_YEAR_FORMATS = tuple(
    f"{first}{separator}{second}"
    for order in ("month_first", "year_first")
    for month in ("%b", "%B")
    for year in ("%Y", "%y")
    for separator in (" ", "-", "'", "/", ".", "")
    for first, second in [(month, year) if order == "month_first" else (year, month)]
)


def _guess_month_year_format(keys: list[str]) -> str | None:
    for date_format in _MONTH_YEAR_FORMATS:
        parsed = pd.to_datetime(pd.Series(keys), format=date_format, errors="coerce")
        if parsed.notna().all():
            return date_format
    return None


def _month_year_patterns(header: str, token: re.Match) -> tuple[str, str]:
    def generalise(text: str) -> str:
        return re.sub(r"\d+", r"\\d+", re.escape(text))

    before = generalise(header[: token.start()])
    after = generalise(header[token.end() :])
    month_year = MONTH_YEAR_TOKEN.pattern.removeprefix("(?i)")
    return f"(?i)^{before}{month_year}{after}$", f"(?i){before}({month_year}){after}$"


def detect_month_name_groups(columns: list[str], taken: set[str] = frozenset()) -> list[dict]:
    """
    Period groups whose headers name the month ("Sales Jan 2026"), shaped like
    the period groups of detect_column_groups. Columns in `taken` are already
    in a group and are left out.
    """
    by_template: dict[str, list[tuple[str, re.Match]]] = {}
    for column in columns:
        if column in taken:
            continue
        token = MONTH_YEAR_TOKEN.search(column)
        if token:
            template = to_snake_case(column[: token.start()] + "<month>" + column[token.end() :])
            by_template.setdefault(template, []).append((column, token))

    groups = []
    for template, members in by_template.items():
        if len(members) < 2:
            continue
        select_pattern, key_pattern = _month_year_patterns(*members[0])
        keys = [token.group(0) for _, token in members]
        groups.append({
            "kind": "period",
            "template": template,
            "columns": [column for column, _ in members],
            "select_pattern": select_pattern,
            "key_pattern": key_pattern,
            "date_format": _guess_month_year_format(keys),
            "period_type": "month",
        })
    return groups


def review_column_groups(columns: list[str]) -> list[dict]:
    """
    Every repeated column group a reviewer can choose as a field's source: the
    ones detect_column_groups finds, and month-named period columns.
    """
    groups = detect_column_groups(columns)
    taken = {column for group in groups for column in group["columns"]}
    return groups + detect_month_name_groups(columns, taken)


# ---- Fingerprint ---------------------------------------------------------------

STORE_COLUMNS_TEMPLATE = "<store_code_columns>"


def layout_templates(columns: list[str]) -> dict[str, list[str]]:
    """
    Each header template in a layout and the columns that share it. A run of
    store-code columns counts as one template, however many outlets it holds.
    """
    dimension_columns = {
        column
        for group in detect_column_groups(columns)
        if group["kind"] == "dimension"
        for column in group["columns"]
    }
    templates: dict[str, list[str]] = {}
    for column in columns:
        template = STORE_COLUMNS_TEMPLATE if column in dimension_columns else header_template(column)
        templates.setdefault(template, []).append(column)
    return templates


def fingerprint(columns: list[str]) -> str:
    """
    Stable identifier for a column layout.

    Built from header templates in source order, with each repeated template
    collapsed to its first occurrence, so the same layout fingerprints identically
    whatever months its headers name and however many outlet columns it has.
    Column order remains part of the signature: moving a field can change the
    meaning of a marker-based selector such as "between OUTLET and Total".
    """
    template_by_column = {
        column: template
        for template, members in layout_templates(columns).items()
        for column in members
    }
    ordered = []
    seen = set()
    for column in columns:
        template = template_by_column[column]
        if template in seen:
            continue
        seen.add(template)
        ordered.append(template)
    joined = "\x1f".join(ordered)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def unordered_fingerprint(columns: list[str]) -> str:
    """The order-free template key used by early version 2 mappings."""
    joined = "\x1f".join(sorted(layout_templates(columns)))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def legacy_fingerprint(columns: list[str]) -> str:
    """
    The fingerprint contracts were stored under before templates: the exact,
    normalised header names. Still looked up so a contract confirmed then is
    found for a file with exactly the same headers.
    """
    normalized = sorted(to_snake_case(c) for c in columns)
    joined = "\x1f".join(normalized)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


# ---- Column profile ------------------------------------------------------------

def _spread(values: list[str]) -> list[str]:
    """Distinct values taken evenly across the whole file, not from its top."""
    if len(values) <= FULL_LIST_LIMIT:
        return values
    step = (len(values) - 1) / (SPREAD_SIZE - 1)
    return [values[round(i * step)] for i in range(SPREAD_SIZE)]


def profile_columns(frame: pd.DataFrame, layout: dict | None = None) -> dict[str, dict]:
    """
    Per-column statistics over every row.

    `values` lists every distinct value of a low-cardinality column and an even
    spread of a high-cardinality one. Spacer and total columns found by layout
    detection are marked with a `role`, so the proposal knows not to map them.
    """
    layout = layout or {}
    roles = {
        **{column: "spacer" for column in layout.get("spacer_columns", [])},
        **{column: "total" for column in layout.get("total_columns", [])},
    }

    profile: dict[str, dict] = {}
    rows = len(frame)
    for column in frame.columns:
        series = frame[column]
        present = series.dropna().astype(str).str.strip()
        present = present[present != ""]
        distinct = list(dict.fromkeys(present.tolist()))

        numbers = pd.to_numeric(present, errors="coerce")
        dates = pd.to_datetime(present, format="ISO8601", errors="coerce")
        if present.empty:
            kind = "empty"
        elif numbers.notna().all():
            kind = "number"
        elif dates.notna().all():
            kind = "date"
        else:
            kind = "text"

        entry = {
            "type": kind,
            "null_rate": round(1 - len(present) / rows, 3) if rows else 1.0,
            "distinct": len(distinct),
            "values": _spread(distinct),
        }
        if kind == "number":
            entry["min"] = float(numbers.min())
            entry["max"] = float(numbers.max())
            entry["negative_share"] = round(float((numbers < 0).mean()), 3)
            entry["zero_share"] = round(float((numbers == 0).mean()), 3)
        elif kind == "date":
            entry["min"] = dates.min().date().isoformat()
            entry["max"] = dates.max().date().isoformat()
        if column in roles:
            entry["role"] = roles[column]
        profile[str(column)] = entry

    return profile


def head_rows(frame: pd.DataFrame, limit: int = 5) -> list[list[str | None]]:
    """
    The first data rows as they sit in the file, one list per row in column
    order, for the review screen's view of the top of the file. Unlike
    column_samples the values stay lined up, so a row reads across.
    """
    head = frame.head(limit).astype(object)
    return [[None if pd.isna(value) else str(value) for value in row] for row in head.itertuples(index=False)]


def column_samples(frame: pd.DataFrame, limit: int = 5) -> dict[str, list[str]]:
    """
    A few real values per source column, for the review screen.

    A reviewer cannot judge whether "Article Description" is a product name or
    a category from the header alone -- the values decide it. Distinct values
    spread across the file, blanks skipped, so a column that samples empty is
    visibly empty.
    """
    samples: dict[str, list[str]] = {}
    for column in frame.columns:
        values = frame[column].dropna().astype(str).str.strip()
        values = values[values != ""].drop_duplicates().tolist()
        if len(values) > limit:
            step = (len(values) - 1) / (limit - 1)
            values = [values[round(i * step)] for i in range(limit)]
        samples[str(column)] = values
    return samples
