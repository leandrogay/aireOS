"""
What the model is told when it proposes a mapping contract, and the shape its
answer must take.

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

from app.services.mapping_contract import DECIDABLE_FIELDS, MEASURE_FIELDS, RULE_OPS
from app.services.reference_contracts import REFERENCE_CONTRACTS

# The field definitions agreed with the product owner (hand-off section 4).
FIELD_DEFINITIONS = {
    "period_start": "First day of the calendar month the sales fall in. Read from a period header, or from a transaction date with month_start.",
    "period_type": "'month' for every retailer. Derived when period column headers say Month/Week; otherwise a constant.",
    "retailer": "Retailer + channel code, lower case: '<family>_online' or '<family>_offline' (fairprice_online, fairprice_offline, nhg_offline, sheng_siong_online, sheng_siong_offline). A supplier or vendor name is NOT the retailer.",
    "store_code": "The retailer's own store/outlet identifier. Not available when the file reports all stores together.",
    "store_name": "Human-readable store name. Not available when the file only has codes.",
    "store_format": "The retailer's store format code (HYPER, SUPER, FPON...).",
    "sku": "The MASTER SKU code (listed under 'SKU master'). When the file's product codes are the master codes (FairPrice article numbers such as 13255043) map the column as it is. Otherwise add a value_map transform -- the product-code table -- giving, for every product code in the file, the master SKU it is, matched on the file's description (range and size). Leave out any code you cannot match; it is flagged for a person.",
    "product_name": "The product's name as the file describes it.",
    "sku_range": "The product range: the kind of product, a level above the SKU and without its size (ADULT DIAPER PANTS, ADULT DIAPER TAPED, Ultra Tape). May be a merchandise-hierarchy column such as MCH.",
    "size": "The product size (S/M, L, XL), from a size column or extracted from a description with regex_extract.",
    "brand": "The brand, if the file has a brand column.",
    "product_category": "The retailer's product category, e.g. a department description.",
    "uom": "Unit of quantity_units: always 'EA' (packs), as a constant -- carton rows are converted with uom_factor, not relabelled.",
    "pack_size": "Pieces per pack. Not a cartons-per-case or packs-per-carton figure.",
    "quantity_units": "Net consumer packs sold in the period; returns reduce it. If sales are recorded as negative numbers, negate. If some rows count cartons, convert with uom_factor.",
    "revenue": "Gross sales value of the units sold, in SGD. NOT a claim, contra, rebate, promotion support, unit price or cost.",
}

GLOSSARY = {
    "MCH": "merchandise category hierarchy, the lowest level: the product range (ADULT DIAPER PANTS / TAPED) -> sku_range",
    "Sales UOM EA / CAR": "each (one pack) / carton",
    "Un. of Entry": "SAP unit of entry",
    "Posting Date": "SAP transaction date",
    "Contra / CMM / Supplier Claim": "a promotion claim against the supplier -- never revenue",
    "_Ecomm suffix on an outlet code": "the online channel",
    "UT / ULT / ULTRA PROTECT": "Ultra",
    "AD": "Adult",
    "P/UP / PULL UP": "pull-up pants",
    "U.TAPE / TAPE DIAPR": "tape diapers",
    "10S / 1X10 / 12S": "pieces per pack (ignore when matching products)",
}

SYSTEM_PROMPT = f"""You map retailer sell-out files onto aireOS's sell-out schema. You are
given a profile of one file -- every column, profiled over every row -- and
you return a mapping contract as JSON matching the response schema. The
contract is a set of instructions: a separate transformation step carries it
out exactly as written, so say everything it needs and nothing it cannot do.

How the contract works
- Every field listed in the schema gets exactly one entry, with a status:
  mapped (from a source column, or from a melt group's key/value), derived
  (period_type from period headers, or another field run through transforms
  via from_field), constant (same value on every row), or not_available.
- not_available is the expected, correct answer when the file does not hold
  a field. Give the reason. Never force a column into a field it does not fit,
  and never invent a value the file does not support.
- Wide columns become rows through melt_groups: a period group (one metric per
  month column; key_target period_start) or a store group (one column per
  outlet code; key_target store_code). Each group fills one measure
  ({', '.join(MEASURE_FIELDS)}). Select a group's columns by rule, never by
  listing them: select_kind 'pattern' with a regex that also matches next
  month's headers, or 'between' two marker columns so a new outlet is picked up.
- Columns named claim, contra, rebate, price, cost or support are never revenue.
- Set aggregate_to_month true when rows must be added up to one row per
  retailer, store, SKU and calendar month: daily or per-transaction rows, or
  several rows for one store and SKU (a carton row and an each row).
- Use the detected groups and layout notes; they come from the whole file.
- Every parameter in the schema must be present. Write "" for a text parameter
  you do not use and 0 for a number you do not use (group 0 means the first
  capture group; a factor of 0 means read it from factor_column).

Transforms (applied in order)
- value_map: exact values to outputs ('values' list of from/to pairs), with an
  optional default. The product-code table on sku is a value_map.
- rules: map values by {', '.join(RULE_OPS)} with a default (FPON -> online;
  outlet codes ending _Ecomm -> online). 'column' tests another column instead.
- negate: sales recorded as negative quantities.
- uom_factor: multiply by a factor per unit in 'column' (factors list).
- month_start: a date read as the first of its month ('format' if not ISO).
- forward_fill: a value given only on the first row of its block.
- zero_as_empty: crosstab cells where 0 means no sale.
- regex_extract: one capture group out of a text value.

Field definitions
{json.dumps(FIELD_DEFINITIONS, indent=2)}

Retailer glossary
{json.dumps(GLOSSARY, indent=2)}

Confidence is for each decision: high when the header and the values leave no
real doubt, medium when likely, low when guessing. A person reviews every low.
The contract is checked against the file and the SKU master afterwards; an
honest not_available costs nothing, a wrong mapping is caught and sent back."""


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
        ],
        "properties": {
            "type": {"type": "string", "enum": [
                "value_map", "rules", "negate", "uom_factor", "month_start",
                "forward_fill", "zero_as_empty", "regex_extract",
            ]},
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
        },
    }

    field = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "target", "status", "source", "melt_group", "from_field", "value",
            "reason", "transforms", "confidence", "rationale",
        ],
        "properties": {
            "target": {"type": "string", "enum": list(DECIDABLE_FIELDS)},
            "status": {"type": "string", "enum": ["mapped", "derived", "constant", "not_available"]},
            "source": _optional(header),
            "melt_group": {"type": "string"},
            "from_field": _optional({"type": "string", "enum": list(DECIDABLE_FIELDS)}),
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
            "confidence", "rationale",
        ],
        "properties": {
            "id": {"type": "string"},
            "select_kind": {"type": "string", "enum": ["pattern", "between"]},
            "select_pattern": {"type": "string"},
            "select_after": _optional(header),
            "select_before": _optional(header),
            "key_target": {"type": "string", "enum": ["period_start", "store_code"]},
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
        "required": ["fields", "melt_groups", "aggregate_to_month"],
        "properties": {
            "melt_groups": {"type": "array", "items": group},
            "fields": {"type": "array", "items": field},
            "aggregate_to_month": {"type": "boolean"},
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
            "sheet", "rejected_sheets", "header_row", "title", "metadata", "stated_period",
            "total_columns", "spacer_columns", "filled_columns", "pivot_totals",
        )
        if layout.get(key)
    }
    if layout.get("footer_rows"):
        layout_notes["footer_rows"] = [row["label"] for row in layout["footer_rows"]]

    examples = "\n\n".join(
        _example(key, entry)
        for key, entry in REFERENCE_CONTRACTS.items()
        if key not in exclude_examples and entry.get("prompt_example", True)
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

Return the contract for this file."""


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
    a version 2 contract (dicts, unused parameters left out).
    """
    fields = {}
    for item in answer.get("fields") or []:
        target = item.get("target")
        if not target or target in fields:
            continue
        entry = {"status": item.get("status")}
        for key in ("source", "melt_group", "from_field", "value", "reason", "confidence", "rationale"):
            if _used(item.get(key)) is not None:
                entry[key] = item[key]
        transforms = []
        for transform in item.get("transforms") or []:
            clean = {"type": transform.get("type")}
            for key in ("pattern", "group", "default", "column", "format"):
                if _used(transform.get(key)) is not None:
                    clean[key] = transform[key]
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
        groups.append(group)

    contract = {"version": 2, "fields": fields, "melt_groups": groups}
    if answer.get("aggregate_to_month"):
        contract["aggregate"] = {"period": "month"}
    return contract
