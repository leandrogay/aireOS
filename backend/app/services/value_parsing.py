"""
Reading the text of a cell as a number or a date.

Every cell of an upload is text (layout_detection), and retailers write the
same figure many ways: "1250.5", "1,250.50", "$1,250.50", "(120)", "120-",
"15%", "1.250,50". Three steps need the same answer to "what number is
this?": the column profile shown to the model (what a column's values look
like), the static checks (would the contract's instructions read them?) and
the transformation (parse_number, parse_date, month_start). It is worked out
once, here, by fixed rules -- a value that fits none of them is not a number
or a date, and is never guessed at.

Pure: text in, numbers and dates out.
"""

import re

import pandas as pd

# ---- Numbers ---------------------------------------------------------------------

DECIMAL_MARKS = (".", ",")

# What may stand beside a figure and be set aside: a currency symbol, with
# the letters some write before it (S$, US$, HK$), or a currency code. A
# fixed list rather than "any letters": "12 EA" and "10S" are not amounts.
_CURRENCY = (
    r"(?:[A-Z]{0,2}[$€£¥₹]|SGD|USD|MYR|RM|EUR|GBP|IDR|THB|PHP|VND|HKD|AUD|CNY|JPY|INR)"
)
_CURRENCY_BEFORE = re.compile(rf"^{_CURRENCY}\s*", re.IGNORECASE)
_CURRENCY_AFTER = re.compile(rf"\s*{_CURRENCY}$", re.IGNORECASE)
# Digits with no grouping, or grouped in threes by the mark that is not the
# decimal mark; "1,25" is not a number written with a decimal point.
_DIGITS = {
    ".": re.compile(r"^(?:\d+|\d{1,3}(?:[, '’]\d{3})+)?(?:\.\d+)?$"),
    ",": re.compile(r"^(?:\d+|\d{1,3}(?:[. '’]\d{3})+)?(?:,\d+)?$"),
}
# A text column this much made of readable numbers is a number column with a
# few stray cells, not a text column.
NUMBER_SHARE = 0.9
_PLAIN = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")
_MINUS_SIGNS = "-−–"


def read_number(value, decimal: str = ".") -> float | None:
    """
    The number one cell's text states, or None when it states none.

    Read as written: a currency symbol or code, thousands separators and a
    percent sign are set aside ("15%" is 15, not 0.15 -- `scale` converts);
    brackets, a leading minus or a trailing one ("120-", as SAP writes it)
    make it negative. `decimal` is the mark before the decimals: "." reads
    "1,250.50", "," reads "1.250,50".
    """
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    if decimal == "." and _PLAIN.match(text):
        return float(text)

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative, text = True, text[1:-1].strip()
    if text and text[0] in _MINUS_SIGNS:
        negative, text = not negative, text[1:].strip()
    elif text and text[-1] in _MINUS_SIGNS:
        negative, text = not negative, text[:-1].strip()
    elif text.startswith("+"):
        text = text[1:].strip()

    text = _CURRENCY_AFTER.sub("", _CURRENCY_BEFORE.sub("", text))
    if text.endswith("%"):
        text = text[:-1].strip()
    # A sign written inside the currency: "$-120".
    if text and text[0] in _MINUS_SIGNS:
        negative, text = not negative, text[1:].strip()

    digits = _DIGITS.get(decimal, _DIGITS["."])
    if not text or not any(character.isdigit() for character in text) or not digits.match(text):
        return None
    grouping = "[, '’]" if decimal != "," else "[. '’]"
    number = float(re.sub(grouping, "", text).replace(",", "."))
    return -number if negative else number


def read_numbers(series: pd.Series, decimal: str = ".") -> pd.Series:
    """Each cell as read_number reads it; NaN where it is blank or not a number."""
    return series.map(lambda value: read_number(value, decimal)).astype("float64")


def is_blank(series: pd.Series) -> pd.Series:
    """Which cells hold nothing: missing, or only spaces."""
    return series.isna() | series.astype(str).str.strip().eq("")


def number_traits(values: list[str]) -> dict | None:
    """
    How a column of text writes its numbers, or None when it is not mostly
    numbers: the decimal mark that reads the most values, what is written
    around the figures, and a few values no rule reads. For the column
    profile, so a proposal is made from how the values are written and not
    from the header.
    """
    values = [str(value).strip() for value in values if str(value).strip()]
    if not values:
        return None
    readable = {mark: [value for value in values if read_number(value, mark) is not None] for mark in DECIMAL_MARKS}
    decimal = max(DECIMAL_MARKS, key=lambda mark: len(readable[mark]))
    if len(readable[decimal]) < NUMBER_SHARE * len(values):
        return None
    joined = " ".join(readable[decimal])
    grouping = r"[, '’]" if decimal == "." else r"[. '’]"
    written_with = [
        label
        for label, pattern in (
            ("currency", r"[$€£¥₹]|[A-Za-z]{2,3}"),
            ("thousands separators", rf"\d{grouping}\d{{3}}(?!\d)"),
            ("percent sign", r"%"),
            ("negatives in brackets", r"\(\s*[^)]*\d"),
            ("trailing minus", r"\d\s*[-−–](?:\s|$)"),
        )
        if re.search(pattern, joined)
    ]
    return {
        "decimal": decimal,
        "written_with": written_with,
        "unreadable": [value for value in values if value not in readable[decimal]][:5],
    }


# ---- Dates -----------------------------------------------------------------------

# Days counted from 30 Dec 1899, as a date cell formatted as a number shows.
EXCEL_SERIAL = "excel_serial"

# strptime reads "Sep", not the "Sept" people write.
_SEPT = re.compile(r"\bsept\b", re.IGNORECASE)

# Tried in this order. Day-first comes before month-first because the
# retailers are Singaporean: "01/08/2026" reads both ways and means 1 August.
DATE_FORMATS = (
    "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y", "%d.%m.%Y", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d",
    "%d/%m/%y", "%m/%d/%y", "%d-%m-%y", "%d.%m.%y",
    "%d %b %Y", "%d-%b-%Y", "%d-%b-%y", "%d %b %y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y",
    "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%d-%m-%Y %H:%M:%S",
)


def month_names(text: str) -> str:
    """A text with "Sept" written "Sep", the only short form strptime reads."""
    return _SEPT.sub("Sep", str(text))


def read_dates(series: pd.Series, date_format: str | None = None) -> pd.Series:
    """
    Each cell as a date; NaT where it is blank or not written that way.

    With no format a cell must be an ISO date ("2026-08-31", as a
    spreadsheet's date cells arrive), never guessed: "01/02/2026" is 1
    February to one reader and 2 January to another, so a column written
    that way needs its `date_format` (strptime, "%d/%m/%Y"). EXCEL_SERIAL
    reads a day count ("46235").
    """
    if pd.api.types.is_datetime64_any_dtype(series):
        return series
    if date_format == EXCEL_SERIAL:
        days = pd.to_numeric(series, errors="coerce")
        return pd.to_datetime(days, unit="D", origin="1899-12-30", errors="coerce")
    text = series.map(lambda value: value if pd.isna(value) or not isinstance(value, str) else month_names(value.strip()))
    try:
        return pd.to_datetime(text, format=date_format or "ISO8601", errors="coerce")
    except (ValueError, TypeError):
        # A format strptime cannot use reads nothing.
        return pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")


def date_formats(values: list[str]) -> list[str]:
    """
    Every format of DATE_FORMATS that reads all of these values, likeliest
    first; [] when they are ISO dates already, not dates, or written more
    than one way. Two answers ("%d/%m/%Y" and "%m/%d/%Y") mean the values do
    not say which comes first, the day or the month.
    """
    series = pd.Series([str(value).strip() for value in values if str(value).strip()], dtype=object)
    if series.empty or read_dates(series).notna().all():
        return []
    return [date_format for date_format in DATE_FORMATS if read_dates(series, date_format).notna().all()]
