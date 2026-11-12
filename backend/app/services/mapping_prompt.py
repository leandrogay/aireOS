"""
What the model is told when it proposes a mapping contract, and the shape its
answer must take.

The model is the only step that understands a file; the transformation that
carries its contract out is deterministic and sees no model. So the prompt has
to give the model the transformation's exact vocabulary -- every transform
with its parameters and what it does with a bad value (TRANSFORM_GUIDE), and
what cannot be done at all (ENGINE_LIMITS) -- and a way to say "this file
needs something else" (`unsupported`) instead of approximating it.

The output schema is built per file: a source column can only be one of this
file's own headers, a target only one of the decidable fields, a status or
transform only one of the fixed lists. Field definitions and the retailer
glossary come from the product owner's hand-off and are the authority on what
each field means. The reference contracts are shown as worked examples, and
the SKU master is listed so the model can build the product-code table.

Pure: builds strings and dicts; calling the API is generate_mapping's job.
"""

import json

import pandas as pd

from app.services.layout_detection import SHEET_COLUMN, filename_period
from app.services.mapping_contract import (
    CELL_TARGETS,
    DATE_TRANSFORMS,
    DECIDABLE_FIELDS,
    EMPTY_TRANSFORMS,
    FILTER_ACTIONS,
    FILTER_OPS,
    LABEL_TARGETS,
    LAYOUT_SOURCES,
    LOOKUP_TRANSFORMS,
    MEASURE_FIELDS,
    MELT_KEY_TARGETS,
    NUMBER_TRANSFORMS,
    RULE_OPS,
    TEXT_CASES,
    TEXT_TRANSFORMS,
    TRANSFORM_TYPES,
)
from app import config
from app.services.reference_contracts import REFERENCE_CONTRACTS

FIELD_DEFINITIONS = {
    "period_start": "First day of the calendar month the sales fall in. Read from a period header, or from a transaction date with month_start. When the table has neither, derive it from_layout 'stated_period' (the period written above the table, or the one heading that is only a month such as 'Aug-26' -- see stated_period in the layout), with period_type the constant 'month'. When the month sits in one cell at the top of the sheet (listed under cells in the layout, e.g. A1 'Jul-26'), from_cell that cell is the same. When nothing inside the file says the period and its name does (filename_period in the layout), derive it from_layout 'filename_period'. For weekly rows dated by a column, parse_date keeps each week's first day. Never type the month in as a constant: next month's file is read through the same contract.",
    "period_type": "'month' for every retailer. Derived when period column headers say Month/Week; otherwise a constant.",
    "retailer": "Retailer + channel code, lower case: '<family>_online' or '<family>_offline' (fairprice_online, fairprice_offline, nhg_offline, sheng_siong_online, sheng_siong_offline). A supplier or vendor name is NOT the retailer. When neither the file nor its name says which retailer it is from, write the family as 'unknown' (unknown_offline) at confidence low for a person to set -- never borrow a retailer from an example.",
    "store_code": "The retailer's own store/outlet identifier. Not available when the file reports all stores together.",
    "store_name": "Human-readable store name. Not available when the file only has codes.",
    "store_format": "The retailer's store format code (HYPER, SUPER, FPON...) which is used to categorize the business.",
    "sku": "The MASTER SKU code (listed under 'SKU master'). When the file's product codes are the master codes (FairPrice article numbers such as 13255043) map the column as it is. Otherwise add a value_map transform -- the product-code table -- giving, for every product code in the file, the master SKU it is, matched on the file's description (range and size). Leave out any code you cannot match; it is flagged for a person.",
    "product_name": "The product's name as the file describes it.",
    "sku_range": "The product range: the kind of product, a level above the SKU and without its size (ADULT DIAPER PANTS, ADULT DIAPER TAPED, Ultra Tape). May be a merchandise-hierarchy column such as MCH.",
    "size": "The product size (S/M, L, XL), from a size column or extracted from a description with regex_extract.",
    "brand": "The brand, if the file has a brand column or extracted from a description with regex_extract.",
    "product_category": "The retailer's product category, e.g. a department description which may be extracted from a description with regex_extract.",
    "uom": "Unit of quantity_units: always 'EA' (packs), as a constant -- carton rows are converted with uom_factor, not relabelled.",
    "pack_size": "Pieces per pack. Not a cartons-per-case or packs-per-carton figure.",
    "quantity_units": "Net consumer packs sold in the period; returns reduce it. If sales are recorded as negative numbers, it may be counted as it is decreasing inventory from the retailer's point of view so should be counted as a sale. If some rows count cartons, convert with uom_factor; if the file counts pieces, divide by the pieces-per-pack column. Returns marked by a type column rather than a sign get uom_factor with factor -1.",
    "revenue": "Gross sales value of the units sold, in SGD. NOT a claim, contra, rebate, promotion support, unit price or cost. When the file has units and a per-unit price but no sales value, derive it from quantity_units with multiply by the price column (confidence medium: a person confirms which price). Net sales and a separate discount column give gross sales with add.",
}

GLOSSARY = {
    "MCH": "merchandise category hierarchy, the lowest level: the product range (ADULT DIAPER PANTS / TAPED) -> sku_range",
    "Sales UOM EA / CAR": "each (one pack) / carton",
    "Un. of Entry": "SAP unit of entry",
    "Posting Date": "SAP transaction date",
    "Contra / Supplier Claim": "a promotion claim against the supplier -- never revenue",
    "_Ecomm suffix on an outlet code": "the online channel",
    "UT / ULT / ULTRA PROTECT": "Ultra",
    "AD": "Adult",
    "P/UP / PULL UP": "pull-up pants",
    "U.TAPE / TAPE DIAPR": "tape diapers",
    "10S / 1X10 / 12S": "pieces per pack (ignore when matching products)",
}

# Every transform the transformation can run, in the model's words: what it is
# for, its parameters, and what it does with a value it cannot handle. One
# entry per mapping_contract.TRANSFORM_TYPES (a test holds the two together),
# so the model is never told of a step that does not exist, nor left unaware
# of one that does.
TRANSFORM_GUIDE = {
    "regex_extract": "keep one part of a text. 'pattern' with at least one capture group, 'group' the one to keep (0 means the first). It must pull a whole value out of every sample, never part of a code split by '/'. No match leaves the cell empty.",
    "split_part": "one part of a compound value ('BB17 - BEDOK'). 'separator' is the text between the parts, 'index' counts them from 1 (-1 is the last). A value without that part is left empty.",
    "replace": "swap or remove text. Every match of the regex 'pattern' becomes 'replacement' ('' removes it): a trailing '^', a 'SKU-' prefix, leading zeros with '^0+'.",
    "normalize_text": "tidy a text: runs of spaces become one and the ends are trimmed; 'case' is upper, lower, title or keep.",
    "concat": "join this value with the same row's values in other 'columns', 'separator' between them ('' joins them directly); empty parts are skipped. For a product or store that only two columns together identify -- then value_map the joined text.",
    "value_map": "exact values to outputs ('values' list of from/to pairs), with an optional 'default' for anything else. The product-code table on sku is a value_map, and it is how categories and yes/no flags are normalised (Y/Yes/TRUE -> one value). At least one 'from' must occur in the column's values. A value not listed, with no default, is left empty.",
    "rules": f"the first rule that matches decides the output; ops {', '.join(RULE_OPS)}; 'default' for no match (FPON -> online; outlet codes ending _Ecomm -> online). 'column' tests another column instead of this value. Each rule needs an op, a value and an output; a regex value must compile.",
    "blank_if": "placeholders that mean 'nothing here' become empty: 'tokens' such as 'N/A', '-', 'NIL' (whole value, case ignored). Put it before the step that reads the value.",
    "fill_empty": "an empty cell takes 'default', or the same row's value in 'column' (the first of two columns that has the value).",
    "forward_fill": "an empty cell takes the value above it: a date or store written only on the first row of its block.",
    "zero_as_empty": "crosstab cells where 0 means no sale are left out instead of loaded as rows that sold nothing.",
    "parse_number": "read a figure that is not written as a plain number. Sets aside a currency symbol or code ('$1,250.50', 'SGD 12'), thousands separators and a percent sign ('15%' reads 15), and reads brackets or a trailing minus as negative ('(120)', '120-'). 'decimal' is '.' ('1,250.50') or ',' ('1.250,50'). Needed whenever the profile says a column is written_as a number; plain numbers need no step. A value it cannot read fails that row.",
    "negate": "flip the sign: sales recorded as negative quantities.",
    "scale": "multiply by the constant 'factor': a percentage to a fraction (0.01), cents to dollars (0.01), dozens to units (12), a figure including 9% GST to one without (0.9174).",
    "uom_factor": "multiply by a factor chosen by the value of 'column' ('factors' list: uom, factor): cartons to packs, or -1 for rows a type column marks as returns. A factor may instead be read from factor_column (e.g. pack size). 'default' is the factor, as a number, for values not listed (1 if \"\").",
    "multiply": "times the same row's value in 'column' (units x unit price).",
    "divide": "divided by the same row's value in 'column' (pieces / pieces per pack = packs). A row whose divisor is empty or 0 fails the file.",
    "add": "plus the same row's value in 'column' (net sales + discount = gross sales); an empty cell adds nothing.",
    "subtract": "minus the same row's value in 'column' (units sold - units returned); an empty cell takes nothing away.",
    "parse_date": "read a date and keep its day (a week's first day). 'format' is its strptime format ('%d/%m/%Y' for 31/12/2025, '%d-%b-%y' for 31-Dec-25), 'excel_serial' for a day count such as 46235, or \"\" for ISO dates (2025-12-31). A date it cannot read fails that row.",
    "month_start": "read a date as parse_date does (same 'format') and keep the first day of its month.",
}

# What the transformation cannot do, said outright so a proposal flags the
# need instead of approximating it.
ENGINE_LIMITS = (
    "It never looks at another row (only forward_fill reads the row above) and never at another file.",
    "It reads one table: the sheet chosen, plus other sheets with exactly the same headers (stacked_sheets). Sheets with other headers are not read.",
    "One row becomes several only through melt_groups; a cell holding several values ('S/M, L') cannot be split into rows.",
    "No formulas beyond the arithmetic steps: no rounding, no conditions on amounts, no exchange rates, no tax tables.",
    "Dates are read by one fixed format per field. It cannot turn a week number, a fiscal period or a quarter into a date, nor read a column that mixes date formats.",
    "Periods are calendar months or weeks. Days are only ever added up to months (aggregate_to_month).",
    "It cannot tell duplicate rows from repeat sales, so it never removes duplicates.",
    "It cannot look a product up by anything but the values in the file: a code the product-code table does not list is flagged for a person.",
)

_TRANSFORM_GROUPS = (
    ("Text", TEXT_TRANSFORMS),
    ("Translating values", LOOKUP_TRANSFORMS),
    ("Empty and placeholder cells", EMPTY_TRANSFORMS),
    ("Figures", NUMBER_TRANSFORMS),
    ("Dates", DATE_TRANSFORMS),
)


def _transform_section() -> str:
    lines = []
    for heading, types in _TRANSFORM_GROUPS:
        lines.append(f"{heading}:")
        lines += [f"- {kind}: {TRANSFORM_GUIDE[kind]}" for kind in types]
    return "\n".join(lines)


SYSTEM_PROMPT = f"""You map retailer sell-out files onto aireOS's sell-out schema. You are
given a profile of one file -- every column, profiled over every row -- and
you return a mapping contract as JSON matching the response schema.

You are the only step that understands the file. The contract is a set of
instructions; a separate transformation carries it out on this file and on
every later file with the same layout, exactly as written, with no model
involved. So the contract must say everything the transformation needs, and
must ask for nothing it cannot do: it knows only the statuses, melt groups,
filters and transforms described here. Do not invent a transform, a
parameter or a behaviour. A step that is not listed is dropped and its field
becomes not_available.

How to work
1. Find each field by its VALUES, not its header. The profile gives every
   column's type, range and values; a header is only a hint ("Amount" may be
   a claim, "Qty" may be cartons).
2. For each column you use, decide how its values are WRITTEN and add the
   steps that turn them into what the field needs:
   - a column typed text with written_as kind 'number' ("$1,250.50",
     "1.250,50", "(120)", "15%") needs parse_number with the decimal mark it
     reports; a plain number column needs nothing
   - a column typed text with written_as kind 'date' ("31/12/2025") needs
     its date_formats entry as the 'format' of month_start (monthly data) or
     parse_date; when two formats are offered the values do not say whether
     the day or the month comes first -- take the day-first one (the
     retailers are Singaporean) at confidence medium. A column typed date is
     ISO already and needs no format
   - a percentage or a figure in another unit (cents, dozens, pieces) needs
     scale, uom_factor or divide after it is read
   - placeholders ("N/A", "-") in a figure column need blank_if first
   - a value holding two things ("BB17 - BEDOK", "AIRE PANTS XL 10S") needs
     split_part or regex_extract; two columns that only together name a
     product or store need concat
   - codes that differ only in case or spacing are matched by value_map and
     rules as they are (both ignore case and outer spaces)
3. Say which rows are sales. Rows that are not -- another supplier's
   products, stock transfers, cancelled orders, section headings inside the
   table -- are left out with filters, never by mapping them to nothing.
4. If the file needs something the transformation cannot do (see "What the
   transformation cannot do"), do not approximate it. Mark the field
   not_available with the reason and add an entry to unsupported saying what
   was needed. An honest gap is reviewed by a person; an approximation loads
   wrong numbers.

How the contract works
- Every field listed in the schema gets exactly one entry, with a status:
  mapped (from a source column, or from a melt group's key, value or label),
  derived (period_type from period headers; another field run through
  transforms via from_field; period_start from_layout 'stated_period' or
  'filename_period'; or from_cell, one cell of the sheet such as 'A1'
  written on every row, for the period or a descriptive field the file
  states once at its top), constant (same value on every row), or
  not_available.
- not_available is the expected, correct answer when the file does not hold
  a field. Give the reason. Never force a column into a field it does not fit,
  and never invent a value the file does not support.
- from_field reads a field that has its own values: one from a column, a melt
  group, a constant, a cell or the stated period -- never one that is itself
  worked out from_field. A field is never worked out from itself.
- from_layout reads the one month the file states for itself, for
  period_start only and with period_type the constant 'month':
  'stated_period' is the period written above the table or the one heading
  that is only a month (stated_period in the layout); 'filename_period' is
  the month in the file's name (filename_period in the layout), for a file
  that carries no date anywhere inside it. Prefer a date column, then
  stated_period or from_cell, and the file's name only when nothing in the
  file says the period.
- from_cell names a cell listed under cells in the layout, written as a
  spreadsheet names it ('A1'). It fills period_start (the cell must read as a
  month such as 'Jul-26', or a date) or a descriptive field
  ({', '.join(CELL_TARGETS[1:])}); never a figure, period_type or pack_size.
  It may carry transforms like a column (a value_map turning the name the
  cell holds into a retailer code, say). Next month's file is read at the
  same cell, so prefer it to a constant whenever the value sits in the file.
- A source column may be one whose heading is a month ('Aug-26' heading the
  product column): next month's file names it 'Sep-26' and it is still found.
- When the layout lists stacked_sheets, the table is every one of those
  sheets, one under the other, and the last column ('{SHEET_COLUMN}') holds the
  sheet each row came from: map it like any column when only the sheet's
  name says the product, store or month.
- Wide columns become rows through melt_groups. Each group fills one measure
  ({', '.join(MEASURE_FIELDS)}) with its cells, and its key_target with each
  column's heading: period_start for one column per month or week, or a
  descriptive field ({', '.join(MELT_KEY_TARGETS[1:])}) for one column per
  outlet, format, brand or product. key_pattern pulls one capture group out
  of the heading. Fields a group fills are mapped with melt_group set to it.
- A period key needs date_format, the strftime format of the heading (or of
  the part key_pattern captures), e.g. '%d-%m-%Y' or '%b-%y'. period_type
  says whether each period column is a 'month' or a 'week'; set it, and
  period_type the field can then be derived from the group.
- Every melt group shares one key_target: the groups are joined on their
  headings (a revenue group and a units group over the same months, say).
  Each measure is filled by at most one group, and a group no field reads is
  dropped.
- A group's labels read more about each melted column: rows_above N fills a
  descriptive field from the cell N rows above its heading (see
  cells_above_header in the layout -- an outlet code written over the outlet
  name), rows_below N (with rows_above 0) from the cell N rows under it (see
  cells_below_header -- an outlet code written under the outlet name; that
  row is then a heading, not data), and rows_above 0 with rows_below 0 reads
  the heading again for a second field. A melted column with nothing there
  fails the file, so only label from a row that has a cell at every melted
  column. Each label fills one field once, and never the field key_target
  fills.
- A store is sold through one retailer: never let the same store code come
  out as both the online and the offline retailer.
- Select a group's columns by rule, never by listing them: select_kind
  'pattern' with a regex that also matches next month's headers, or 'between'
  two marker columns (select_before "" runs to the last column) so a new
  outlet is picked up. Never take in a column the layout lists under
  total_columns (a column that adds up the others may have no heading:
  'Unnamed: 8'); end the selection before it with select_before.
- Columns named claim, contra, rebate, price, cost or support are never mapped
  as revenue. A per-unit price may only be the multiply column of a revenue
  derived from quantity_units.
- Set aggregate_to_month true when rows must be added up to one row per
  retailer, store, SKU and calendar month: daily or per-transaction rows, or
  several rows for one store and SKU (a carton row and an each row).
- Use the detected groups and layout notes; they come from the whole file.
- Every parameter in the schema must be present. Write "" for a text parameter
  you do not use, 0 for a number you do not use and [] for a list you do not
  use (group 0 means the first capture group; a factor of 0 in a factors
  entry means read it from factor_column).

Row filters (filters, applied in order before anything else is read)
- Each tests one 'column' of the file with an 'op' ({', '.join(FILTER_OPS)})
  and a 'value' ("" for empty), and its 'action' is 'drop' (leave the
  matching rows out) or 'keep' (load only the matching rows).
- Use them for rows that are not this supplier's sales. Do not use them to
  hide rows whose values you could not map: those must fail the checks.
- A filter that would remove every row, or names a column missing from the
  file, fails. Most files need none: return [].

Transforms (a field's 'transforms' list, applied in order; each step's
'type' is one of these and no other; value_map and rules ignore case unless
case_sensitive is true)
{_transform_section()}

Transforms compose. A sales value written '$1,250.50' on rows that a 'Type'
column marks as returns: parse_number, then uom_factor on 'Type' with factor
-1 for RETURN. A discount written '15%' that the schema has no field for is
simply not mapped. A date written '31/12/2025' in a monthly file:
month_start with 'format' '%d/%m/%Y'.

What the transformation cannot do
{chr(10).join(f"- {limit}" for limit in ENGINE_LIMITS)}
When one of these stands between the file and a field, that field is
not_available and unsupported gets an entry: 'field' the field concerned
("" when it concerns the whole file) and 'issue' one sentence a reviewer can
act on. Return [] when the vocabulary covers the file.

Field definitions
{json.dumps(FIELD_DEFINITIONS, indent=2)}

Retailer glossary
{json.dumps(GLOSSARY, indent=2)}

Confidence is for each decision: high when the header and the values leave no
real doubt, medium when likely, low when guessing. A human reviews every low and medium.
The contract is checked against the file and the SKU master afterwards --
every product code, every rule value, every figure and date the steps must
read -- and a failed check is sent back to you with the values that failed.
An honest not_available costs nothing, a wrong mapping is caught and sent back."""


# Columns with at most this many distinct values are treated as describing the
# product or the store, and their distinct combinations shown, so the model
# can pair each product code with its description.
PAIR_COLUMN_LIMIT = 60
PAIR_ROW_LIMIT = 120


# Structured outputs limit how many parameters may be a union (anyOf / a type
# list, which every nullable parameter is): 16, and this schema would need 18.
# So nothing is nullable. An empty string (or 0 for a number) means "not used",
# and parse_proposal reads it back as absent.
UNUSED = ""


def _optional(schema: dict) -> dict:
    """A parameter that may be left unused: an empty string, or 0 for a number."""
    if "enum" in schema:
        return {**schema, "enum": [*schema["enum"], UNUSED]}
    return schema


def output_schema(columns: list[str]) -> dict:
    """
    The JSON schema the model's answer must match, specific to these headers.
    Free of union types (see UNUSED).
    """
    header = {"type": "string", "enum": list(columns)} if columns else {"type": "string"}
    confidence = {"type": "string", "enum": ["high", "medium", "low"]}

    transform = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "type", "pattern", "group", "values", "rules", "default",
            "case_sensitive", "column", "factors", "format",
            "decimal", "factor", "case", "replacement", "tokens", "columns", "separator", "index",
        ],
        "properties": {
            "type": {"type": "string", "enum": list(TRANSFORM_TYPES)},
            "pattern": {"type": "string"},
            "group": {"type": "integer"},
            "values": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["from", "to"],
                    "properties": {"from": {"type": "string"}, "to": {"type": "string"}},
                },
            },
            "rules": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["op", "value", "output"],
                    "properties": {
                        "op": {"type": "string", "enum": list(RULE_OPS)},
                        "value": {"type": "string"},
                        "output": {"type": "string"},
                    },
                },
            },
            "default": {"type": "string"},
            "case_sensitive": {"type": "boolean"},
            "column": _optional(header),
            "factors": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["uom", "factor", "factor_column"],
                    "properties": {
                        "uom": {"type": "string"},
                        "factor": {"type": "number"},
                        "factor_column": _optional(header),
                    },
                },
            },
            "format": {"type": "string"},
            "decimal": _optional({"type": "string", "enum": [".", ","]}),
            "factor": {"type": "number"},
            "case": _optional({"type": "string", "enum": list(TEXT_CASES)}),
            "replacement": {"type": "string"},
            "tokens": {"type": "array", "items": {"type": "string"}},
            "columns": {"type": "array", "items": header},
            "separator": {"type": "string"},
            "index": {"type": "integer"},
        },
    }

    row_filter = {
        "type": "object",
        "additionalProperties": False,
        "required": ["column", "op", "value", "action", "case_sensitive"],
        "properties": {
            "column": header,
            "op": {"type": "string", "enum": list(FILTER_OPS)},
            "value": {"type": "string"},
            "action": {"type": "string", "enum": list(FILTER_ACTIONS)},
            "case_sensitive": {"type": "boolean"},
        },
    }

    unsupported = {
        "type": "object",
        "additionalProperties": False,
        "required": ["field", "issue"],
        "properties": {
            "field": _optional({"type": "string", "enum": list(DECIDABLE_FIELDS)}),
            "issue": {"type": "string"},
        },
    }

    field = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "target", "status", "source", "melt_group", "from_field", "from_layout",
            "from_cell", "value", "reason", "transforms", "confidence", "rationale",
        ],
        "properties": {
            "target": {"type": "string", "enum": list(DECIDABLE_FIELDS)},
            "status": {"type": "string", "enum": ["mapped", "derived", "constant", "not_available"]},
            "source": _optional(header),
            "melt_group": {"type": "string"},
            "from_field": _optional({"type": "string", "enum": list(DECIDABLE_FIELDS)}),
            "from_layout": _optional({"type": "string", "enum": list(LAYOUT_SOURCES)}),
            "from_cell": {"type": "string"},
            "value": {"type": "string"},
            "reason": {"type": "string"},
            "transforms": {"type": "array", "items": transform},
            "confidence": confidence,
            "rationale": {"type": "string"},
        },
    }

    group = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "id", "select_kind", "select_pattern", "select_after", "select_before",
            "key_target", "key_pattern", "date_format", "period_type", "value_target",
            "labels", "confidence", "rationale",
        ],
        "properties": {
            "id": {"type": "string"},
            "select_kind": {"type": "string", "enum": ["pattern", "between"]},
            "select_pattern": {"type": "string"},
            "select_after": _optional(header),
            "select_before": _optional(header),
            "key_target": {"type": "string", "enum": list(MELT_KEY_TARGETS)},
            "labels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["rows_above", "rows_below", "target"],
                    "properties": {
                        "rows_above": {"type": "integer"},
                        "rows_below": {"type": "integer"},
                        "target": {"type": "string", "enum": list(LABEL_TARGETS)},
                    },
                },
            },
            "key_pattern": {"type": "string"},
            "date_format": {"type": "string"},
            "period_type": _optional({"type": "string", "enum": ["month", "week"]}),
            "value_target": {"type": "string", "enum": list(MEASURE_FIELDS)},
            "confidence": confidence,
            "rationale": {"type": "string"},
        },
    }

    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["fields", "melt_groups", "filters", "aggregate_to_month", "unsupported"],
        "properties": {
            "melt_groups": {"type": "array", "items": group},
            "fields": {"type": "array", "items": field},
            "filters": {"type": "array", "items": row_filter},
            "aggregate_to_month": {"type": "boolean"},
            "unsupported": {"type": "array", "items": unsupported},
        },
    }


def value_pairs(frame: pd.DataFrame, profile: dict, groups: list[dict]) -> list[dict]:
    """
    The distinct combinations of the file's descriptive columns (few distinct
    values, not melted, not spacer or total), so a product code can be read
    beside its description. Columns are profiled one at a time; this is what
    ties them together.
    """
    melted = {column for group in groups for column in group.get("columns", [])}
    columns = [
        column
        for column, entry in profile.items()
        if column not in melted
        and not entry.get("role")
        and entry["type"] in ("text", "number")
        and 1 < entry["distinct"] <= PAIR_COLUMN_LIMIT
    ]
    if not columns:
        return []
    distinct = frame[columns].drop_duplicates().head(PAIR_ROW_LIMIT)
    return distinct.astype(object).where(distinct.notna(), None).to_dict(orient="records")


def _example(key: str, entry: dict) -> str:
    contract = entry["contract"]
    compact = {
        "fields": {
            target: {k: v for k, v in decision.items() if k not in ("confidence", "rationale", "reviewed")}
            for target, decision in contract["fields"].items()
        },
        "melt_groups": [
            {k: v for k, v in group.items() if k not in ("confidence", "rationale", "reviewed")}
            for group in contract["melt_groups"]
        ],
        "aggregate_to_month": bool(contract.get("aggregate")),
    }
    return f"Example -- {entry['name']} ({entry['description']}):\n{json.dumps(compact, indent=1)}"


def user_prompt(
    filename: str,
    profile: dict,
    groups: list[dict],
    layout: dict,
    rows: int,
    master_skus: list[dict],
    pairs: list[dict],
    exclude_examples: tuple[str, ...] = (),
) -> str:
    """
    The per-file message: the layout, the whole-file profile, the detected
    groups, the descriptive value combinations, the SKU master, and the
    reference contracts as examples (`exclude_examples` hides some, which is
    how the eval tests a retailer without its own answer).
    """
    layout_notes = {
        key: layout.get(key)
        for key in (
            "sheet", "stacked_sheets", "rejected_sheets", "header_row", "title", "metadata", "stated_period",
            "total_columns", "spacer_columns", "filled_columns", "pivot_totals",
        )
        if layout.get(key)
    }
    # What from_layout 'filename_period' would read.
    if filename_period(filename):
        layout_notes["filename_period"] = filename_period(filename)
    if layout.get("footer_rows"):
        layout_notes["footer_rows"] = [row["label"] for row in layout["footer_rows"]]
    # Counted up from the header, as a melt group's labels count them.
    if layout.get("rows_above_header") and layout.get("header_row"):
        layout_notes["cells_above_header"] = [
            {"rows_above": int(layout["header_row"]) - item["row"], "cells": item["cells"]}
            for item in layout["rows_above_header"]
        ]
    # Counted down from the header, as rows_below counts them.
    if layout.get("rows_below_header") and layout.get("header_row"):
        layout_notes["cells_below_header"] = [
            {"rows_below": item["row"] - int(layout["header_row"]), "cells": item["cells"]}
            for item in layout["rows_below_header"]
        ]
    # Cells by reference, from the top of the sheet down to the header: what from_cell may name.
    if layout.get("cells") and layout.get("header_row"):
        top = int(layout["header_row"])
        layout_notes["cells"] = {
            reference: value
            for reference, value in layout["cells"].items()
            if int(reference.lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")) <= top
        }

    examples = "\n\n".join(
        _example(key, entry)
        for key, entry in REFERENCE_CONTRACTS.items()
        if key not in exclude_examples
        and entry.get("prompt_example", True)
        and not config.mapping_examples_disabled()
    )
    master = [
        {key: product.get(key) for key in ("sku", "product_name", "sku_range", "size")}
        for product in master_skus
    ]

    return f"""File: {filename}

Layout (data table already located; footers and pivots set aside):
{json.dumps(layout_notes, indent=1, default=str)}

Column profile over all {rows} data rows:
{json.dumps(profile, indent=1, default=str)}

Detected column groups:
{json.dumps(groups, indent=1)}

Distinct combinations of the descriptive columns (use them to pair each
product code with its description):
{json.dumps(pairs, indent=1, default=str)}

SKU master (the sku field must end up as one of these codes):
{json.dumps(master, indent=1)}

{examples}
Return ONLY valid, raw JSON. Do not use markdown formatting blocks (```json). Do not include any conversational text before or after the JSON object.
"""


def repair_prompt(failed: list[dict], warnings: list[str]) -> str:
    """Sent back after a proposal fails its checks, with the evidence."""
    lines = [f"- {check['message']} (evidence: {json.dumps(check['evidence'], default=str)})" for check in failed]
    lines += [f"- {warning}" for warning in warnings]
    return (
        "That contract was checked against the file and these checks failed:\n"
        + "\n".join(lines)
        + "\n\nReturn the full corrected contract."
    )


def _used(value):
    """A parameter's value, or None when it was left unused ("" / 0 / null)."""
    if value is None or value == UNUSED or (isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0):
        return None
    return value


def parse_proposal(answer: dict) -> dict:
    """
    The model's answer (lists, every parameter present, "" or 0 for unused) as
    a contract (dicts, unused parameters left out).
    """
    fields = {}
    for item in answer.get("fields") or []:
        target = item.get("target")
        if not target or target in fields:
            continue
        entry = {"status": item.get("status")}
        for key in ("source", "melt_group", "from_field", "from_layout", "from_cell", "value", "reason", "confidence", "rationale"):
            if _used(item.get(key)) is not None:
                entry[key] = item[key]
        transforms = []
        for transform in item.get("transforms") or []:
            clean = {"type": transform.get("type")}
            for key in ("pattern", "group", "default", "column", "format", "decimal", "factor", "case", "index"):
                if _used(transform.get(key)) is not None:
                    clean[key] = transform[key]
            # "" is a meaning here, not "unused": remove the match, join with nothing between.
            if clean["type"] == "replace":
                clean["replacement"] = transform.get("replacement") or ""
            if clean["type"] in ("concat", "split_part"):
                clean["separator"] = transform.get("separator") or ""
            if transform.get("tokens"):
                clean["tokens"] = list(transform["tokens"])
            if transform.get("columns"):
                clean["columns"] = [column for column in transform["columns"] if _used(column) is not None]
            if transform.get("values"):
                clean["values"] = {pair["from"]: pair["to"] for pair in transform["values"]}
            if transform.get("rules"):
                clean["rules"] = transform["rules"]
            if transform.get("case_sensitive"):
                clean["case_sensitive"] = True
            if transform.get("factors"):
                clean["factors"] = {
                    factor["uom"]: (
                        {"column": factor["factor_column"]} if _used(factor.get("factor_column")) else factor.get("factor")
                    )
                    for factor in transform["factors"]
                }
            # The schema's default is text; a uom_factor's default is a number.
            if clean["type"] == "uom_factor" and "default" in clean:
                try:
                    clean["default"] = float(clean["default"])
                except ValueError:
                    del clean["default"]
            transforms.append(clean)
        if transforms:
            entry["transforms"] = transforms
        fields[target] = entry

    groups = []
    for item in answer.get("melt_groups") or []:
        if item.get("select_kind") == "between":
            select = {"kind": "between", "after": _used(item.get("select_after")), "before": _used(item.get("select_before"))}
        else:
            select = {"kind": "pattern", "pattern": item.get("select_pattern")}
        key = {"target": item.get("key_target")}
        if item.get("key_pattern"):
            key["pattern"] = item["key_pattern"]
        if item.get("date_format"):
            key["date_format"] = item["date_format"]
        group = {
            "id": item.get("id"),
            "select": select,
            "key": key,
            "value_target": item.get("value_target"),
            "confidence": item.get("confidence"),
            "rationale": item.get("rationale"),
        }
        if item.get("period_type"):
            group["period_type"] = item["period_type"]
        # rows_above 0 is meaningful here (the heading again), so not _used();
        # a rows_below of 1 or more reads under the heading instead.
        if item.get("labels"):
            group["labels"] = [
                {"rows_below": label["rows_below"], "target": label["target"]}
                if _used(label.get("rows_below"))
                else {"rows_above": label["rows_above"], "target": label["target"]}
                for label in item["labels"]
            ]
        groups.append(group)

    contract = {"fields": fields, "melt_groups": groups}
    if answer.get("filters"):
        contract["filters"] = [dict(row_filter) for row_filter in answer["filters"]]
    if answer.get("unsupported"):
        contract["unsupported"] = [
            {"field": _used(item.get("field")), "issue": item.get("issue")} for item in answer["unsupported"]
        ]
    if answer.get("aggregate_to_month"):
        contract["aggregate"] = {"period": "month"}
    return contract
