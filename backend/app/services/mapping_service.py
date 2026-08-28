import re
from typing import Any, Dict, List, Optional

import pandas as pd


# The 19 business fields produced by AO1-2. Pipeline/audit fields such as
# loaded_at, data_source, entered_by and entered_at are deliberately excluded.
TARGET_SCHEMA = [
    "period_start", "period_end", "period_type", "retailer",
    "store_code", "store_name", "store_format", "sku",
    "product_name", "sku_range", "size", "brand",
    "product_category", "uom", "pack_size", "quantity_units",
    "revenue", "source_file", "period_label",
]

FAIRPRICE_DIMENSION_HEADERS = [
    "Vendor Code", "Vendor Name", "Dept Code", "Dept Description",
    "Class No.", "Class Description", "Sub Class Description", "MCH",
    "SKU No.", "Article Description", "Brand", "Sales UOM", "Pack Size",
    "Store Code", "Store Name", "Store Format",
]

_SALES_HEADER = re.compile(
    r"^SALES \| (Week|Month) ([1-9]\d*) \| (\d{2}-\d{2}-\d{4})$"
)
_QUANTITY_HEADER = re.compile(
    r"^Qty \(in EA\) \| (Week|Month) ([1-9]\d*) \| (\d{2}-\d{2}-\d{4})$"
)
_PACK_SUFFIX = re.compile(r"\s+\d+S$", re.IGNORECASE)
_SIZE = re.compile(r"\b(S/M|XL|L|M|S)\b", re.IGNORECASE)


# The measure block headers carry the period number and date, so they differ in
# every file. A catalog mapping therefore stores the pattern, not the literal
# header, and the recogniser matches it at ingest time.
SALES_HEADER_PATTERN = "SALES | {Week|Month} {n} | {DD-MM-YYYY}"
QUANTITY_HEADER_PATTERN = "Qty (in EA) | {Week|Month} {n} | {DD-MM-YYYY}"
UPLOAD_FILENAME_SOURCE = "(upload filename)"

# Every source column this mapping can read: the fixed dimension block plus the
# two pattern-matched measure headers. This is what belongs in columns_json --
# the dimension headers alone leave revenue and quantity_units unexplained.
FAIRPRICE_SOURCE_COLUMNS = FAIRPRICE_DIMENSION_HEADERS + [
    SALES_HEADER_PATTERN,
    QUANTITY_HEADER_PATTERN,
]

# The declarative twin of apply_existing_mapping() below. Keep the two in step:
# this list is what gets persisted and rendered, that function is what runs.
# "mapped" is a straight carry-through, "derived" needs a transform first.
FAIRPRICE_WIDE_FIELD_MAP = [
    {"sourceColumn": "SKU No.", "targetField": "sku", "status": "mapped", "transform": None},
    {"sourceColumn": "Store Code", "targetField": "store_code", "status": "mapped", "transform": None},
    {"sourceColumn": "Store Name", "targetField": "store_name", "status": "mapped", "transform": "trim"},
    {"sourceColumn": "Store Format", "targetField": "store_format", "status": "mapped", "transform": "trim"},
    {"sourceColumn": "Brand", "targetField": "brand", "status": "mapped", "transform": "trim"},
    {"sourceColumn": "Sales UOM", "targetField": "uom", "status": "mapped", "transform": "trim"},
    {"sourceColumn": "Pack Size", "targetField": "pack_size", "status": "mapped", "transform": None},
    {
        "sourceColumn": "Article Description",
        "targetField": "product_name",
        "status": "derived",
        "transform": "collapse whitespace, drop trailing pack suffix, title case",
    },
    {
        "sourceColumn": "Article Description",
        "targetField": "size",
        "status": "derived",
        "transform": "extract S / M / L / XL / S/M token from the cleaned product name",
    },
    {
        "sourceColumn": "MCH",
        "targetField": "product_category",
        "status": "derived",
        "transform": "title case",
    },
    {
        "sourceColumn": "Brand + MCH",
        "targetField": "sku_range",
        "status": "derived",
        "transform": "title case both, join with a space",
    },
    {
        "sourceColumn": "Store Format",
        "targetField": "retailer",
        "status": "derived",
        "transform": "FPON -> fairprice_online, anything else -> fairprice_offline",
    },
    {
        "sourceColumn": SALES_HEADER_PATTERN,
        "targetField": "revenue",
        "status": "mapped",
        "transform": None,
    },
    {
        "sourceColumn": QUANTITY_HEADER_PATTERN,
        "targetField": "quantity_units",
        "status": "mapped",
        "transform": None,
    },
    {
        "sourceColumn": SALES_HEADER_PATTERN,
        "targetField": "period_start",
        "status": "derived",
        "transform": "parse the DD-MM-YYYY date out of the period header",
    },
    {
        "sourceColumn": SALES_HEADER_PATTERN,
        "targetField": "period_end",
        "status": "derived",
        "transform": "week: period_start + 6 days; month: last day of that month",
    },
    {
        "sourceColumn": SALES_HEADER_PATTERN,
        "targetField": "period_type",
        "status": "derived",
        "transform": "Week / Month token from the period header, lowercased",
    },
    {
        "sourceColumn": SALES_HEADER_PATTERN,
        "targetField": "period_label",
        "status": "derived",
        "transform": "week: 'Week N (DD-MM-YYYY)'; month: 'YYYY-Mnn'",
    },
    {
        "sourceColumn": UPLOAD_FILENAME_SOURCE,
        "targetField": "source_file",
        "status": "derived",
        "transform": "name of the uploaded file",
    },
]


def _referenced_source_columns() -> set:
    referenced = set()
    for entry in FAIRPRICE_WIDE_FIELD_MAP:
        referenced.update(part.strip() for part in entry["sourceColumn"].split(" + "))
    return referenced


# Dimension headers the retailer sends that the target schema has no home for.
FAIRPRICE_UNMAPPED_HEADERS = [
    header
    for header in FAIRPRICE_DIMENSION_HEADERS
    if header not in _referenced_source_columns()
]


def build_fairprice_wide_rules() -> List[Dict[str, Any]]:
    """Return the mapping as one rule per target field, in TARGET_SCHEMA order.

    A stored mapping is a rule set, not a reading of some file, so there are no
    "unmapped" rows here -- headers the mapping ignores live in
    FAIRPRICE_UNMAPPED_HEADERS and are reported alongside, not as rules.
    """
    order = {field: index for index, field in enumerate(TARGET_SCHEMA)}
    return sorted(
        (dict(entry) for entry in FAIRPRICE_WIDE_FIELD_MAP),
        key=lambda rule: order[rule["targetField"]],
    )


def extract_header_signature(df: pd.DataFrame) -> List[str]:
    """Return the exact ordered source headers; filenames are never involved."""
    return [str(column) for column in df.columns]


def _parse_period_headers(
    sales_headers: List[str], quantity_headers: List[str]
) -> Optional[List[Dict[str, Any]]]:
    if not sales_headers or len(sales_headers) != len(quantity_headers):
        return None

    periods = []
    for expected_number, (sales_header, quantity_header) in enumerate(
        zip(sales_headers, quantity_headers), start=1
    ):
        sales_match = _SALES_HEADER.fullmatch(sales_header)
        quantity_match = _QUANTITY_HEADER.fullmatch(quantity_header)
        if not sales_match or not quantity_match:
            return None

        sales_type, sales_number, sales_date = sales_match.groups()
        quantity_type, quantity_number, quantity_date = quantity_match.groups()
        if (
            sales_type != quantity_type
            or sales_number != quantity_number
            or sales_date != quantity_date
            or int(sales_number) != expected_number
        ):
            return None

        periods.append(
            {
                "period_type": sales_type.lower(),
                "period_number": int(sales_number),
                "period_date": sales_date,
                "sales_header": sales_header,
                "quantity_header": quantity_header,
            }
        )

    if len({period["period_type"] for period in periods}) != 1:
        return None
    return periods


def _match_fairprice_wide(header_signature: List[str]) -> Optional[Dict[str, Any]]:
    dimension_count = len(FAIRPRICE_DIMENSION_HEADERS)
    if header_signature[:dimension_count] != FAIRPRICE_DIMENSION_HEADERS:
        return None

    measure_headers = header_signature[dimension_count:]
    sales_headers = [h for h in measure_headers if h.startswith("SALES |")]
    quantity_headers = [h for h in measure_headers if h.startswith("Qty (in EA) |")]

    # FairPrice places every SALES period first, followed by the matching Qty
    # period block. No unknown columns are accepted between or after them.
    if measure_headers != sales_headers + quantity_headers:
        return None

    periods = _parse_period_headers(sales_headers, quantity_headers)
    if periods is None:
        return None

    return {
        "mapping_id": "fairprice_wide_v1",
        "retailer_family": "fairprice",
        "period_type": periods[0]["period_type"],
        "periods": periods,
        "source_headers": header_signature,
    }


# Future retailer recognisers can be appended here without changing the public
# matching function or the ingestion workflow.
MAPPING_RECOGNISERS = (_match_fairprice_wide,)


def find_matching_mapping(header_signature: List[str]) -> Optional[Dict[str, Any]]:
    """Return the first deterministic mapping whose ordered schema matches."""
    for recognise in MAPPING_RECOGNISERS:
        mapping = recognise(header_signature)
        if mapping is not None:
            return mapping
    return None


def _clean_product_name(value: Any) -> Any:
    if pd.isna(value):
        return None
    collapsed = " ".join(str(value).split())
    titled = _PACK_SUFFIX.sub("", collapsed).title()
    return _SIZE.sub(lambda match: match.group(1).upper(), titled)


def _title_case(value: Any) -> Any:
    if pd.isna(value):
        return None
    return " ".join(str(value).split()).title()


def _extract_size(product_name: Any) -> Any:
    if not product_name:
        return None
    match = _SIZE.search(str(product_name))
    return match.group(1).upper() if match else None


def apply_existing_mapping(
    df: pd.DataFrame, mapping: Dict[str, Any], filename: str
) -> pd.DataFrame:
    """Apply a recognised mapping and return only the 19 standard fields."""
    if mapping.get("mapping_id") != "fairprice_wide_v1":
        raise ValueError(f"Unsupported mapping: {mapping.get('mapping_id')}")

    output_frames = []
    for period in mapping["periods"]:
        period_start = pd.to_datetime(
            period["period_date"], format="%d-%m-%Y", errors="raise"
        )
        if period["period_type"] == "week":
            period_end = period_start + pd.Timedelta(days=6)
            period_label = (
                f"Week {period['period_number']} ({period_start.strftime('%d-%m-%Y')})"
            )
        else:
            period_end = period_start + pd.offsets.MonthEnd(0)
            period_label = f"{period_start.year}-M{period_start.month:02d}"

        period_df = pd.DataFrame(index=df.index)
        period_df["period_start"] = period_start
        period_df["period_end"] = period_end
        period_df["period_type"] = period["period_type"]
        period_df["retailer"] = df["Store Format"].map(
            lambda value: "fairprice_online"
            if str(value).strip().upper() == "FPON"
            else "fairprice_offline"
        )
        period_df["store_code"] = df["Store Code"]
        period_df["store_name"] = df["Store Name"].astype("string").str.strip()
        period_df["store_format"] = df["Store Format"].astype("string").str.strip()
        period_df["sku"] = df["SKU No."]
        period_df["product_name"] = df["Article Description"].map(_clean_product_name)
        period_df["sku_range"] = (
            df["Brand"].map(_title_case).fillna("")
            + " "
            + df["MCH"].map(_title_case).fillna("")
        ).str.strip()
        period_df["size"] = period_df["product_name"].map(_extract_size)
        period_df["brand"] = df["Brand"].astype("string").str.strip()
        period_df["product_category"] = df["MCH"].map(_title_case)
        period_df["uom"] = df["Sales UOM"].astype("string").str.strip()
        period_df["pack_size"] = df["Pack Size"]
        period_df["quantity_units"] = df[period["quantity_header"]]
        period_df["revenue"] = df[period["sales_header"]]
        period_df["source_file"] = filename
        period_df["period_label"] = period_label

        # A blank period in the wide source is absence of a sales record, not a
        # rejected row. If only one measure is present, keep it for validation.
        has_measure = period_df[["quantity_units", "revenue"]].notna().any(axis=1)
        output_frames.append(period_df.loc[has_measure, TARGET_SCHEMA])

    if not output_frames:
        return pd.DataFrame(columns=TARGET_SCHEMA)
    return pd.concat(output_frames, ignore_index=True)[TARGET_SCHEMA]
