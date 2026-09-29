"""Canonical fields and types for cleaned sell-out ingestion."""

BUSINESS_COLUMNS = [
    "period_start", "period_end", "period_type", "retailer",
    "store_code", "store_name", "store_format", "sku",
    "product_name", "sku_range", "size", "brand",
    "product_category", "uom", "pack_size", "quantity_units",
    "revenue", "source_file", "period_label",
]

REQUIRED_COLUMNS = [
    "period_start",
    "period_end",
    "period_type",
    "retailer",
    "store_code",
    "sku",
]

DATE_COLUMNS = ["period_start", "period_end"]
NUMERIC_COLUMNS = ["pack_size", "quantity_units", "revenue"]
