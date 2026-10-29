"""
Hand-written mapping contracts for the three retailer layouts seen so far.

They encode the business rules agreed with the product owner (mapping hand-off,
sections 2-4), and are used three ways: as the contracts the golden tests check
against the sample files, as worked examples shown to the model when it
proposes a contract for a new file, and as the answer key the mapping eval
scores proposals against (scripts/eval_mapping.py). Python rather than JSON
because the repo ignores *.json.

The layout section is not written here: it is what layout detection finds in
the file, attached when a contract is made for one (layout_instructions).

Open decisions they assume, each a one-line change here:
  D1  FairPrice CAR rows are already counted in packs (factor 1)
  D2  FairPrice "Pack Size" is packs per carton, not pieces per pack
  D3  retailer codes nhg_offline, sheng_siong_offline, sheng_siong_online
  D4  the product-code tables are the hand-off's proposed matches (section 7)
  D8  Sheng Siong claim quantities are tagged 'promo_claim'
"""

import copy

from app.services.mapping_contract import monthly_aggregate

# D1: packs per FairPrice "CAR" (carton) row. The column header says
# "Qty (in EA)" and carton rows' revenue per unit matches a pack, not a carton,
# so the quantity is already in packs. Set to {"column": "Pack Size"} to
# multiply by the carton size instead.
FAIRPRICE_CAR_FACTOR = 1

# D4: each retailer's product codes and the master SKU they are, matched by
# description and size in the hand-off. The Sheng Siong XL codes are unknown
# (that file had no XL sales); a file that has them fails the product-code
# check until they are added here or on the review screen.
NHG_CODES = {
    "0059-01-027-R": "13255043", "0059-01-026-R": "13255044", "0059-01-025-R": "13255045",
    "0059-01-034-R": "13271337", "0059-01-037-R": "13271338", "0059-01-032-R": "13271339",
    "0059-01-033-R": "13271340", "0059-01-036-R": "13271341", "0059-01-038-R": "13271342",
}
SHENG_SIONG_CODES = {
    "1909284": "13255045", "1909285": "13255044", "1909282": "13271340",
    "1909283": "13271339", "1909280": "13271338", "1909281": "13271341",
}

# A size token read whole: "S/M" before its parts.
SIZE_PATTERN = r"\b(S/M|XL|L)\b"

_SURE = {"confidence": "high", "rationale": "Reference contract.", "reviewed": True}


def _field(**entry) -> dict:
    return {**entry, **_SURE}


def _size_from(column: str) -> dict:
    return _field(
        status="mapped", source=column,
        transforms=[{"type": "regex_extract", "pattern": SIZE_PATTERN, "group": 1}],
    )


def _not_in_file(reason: str) -> dict:
    return _field(status="not_available", reason=reason)


# Quantities are packs whatever unit a row is counted in (hand-off section 4).
_PACKS = _field(status="constant", value="EA")


FAIRPRICE_MONTHLY = {
    "version": 2,
    "fields": {
        "period_start": _field(status="mapped", melt_group="sales"),
        "period_type": _field(status="derived"),
        # Store format FPON (store 4, FAIRPRICE ON) is the online channel.
        "retailer": _field(
            status="mapped",
            source="Store Format",
            transforms=[{
                "type": "rules",
                "rules": [{"op": "equals", "value": "FPON", "output": "fairprice_online"}],
                "default": "fairprice_offline",
            }],
        ),
        "store_code": _field(status="mapped", source="Store Code"),
        "store_name": _field(status="mapped", source="Store Name"),
        "store_format": _field(status="mapped", source="Store Format"),
        "sku": _field(status="mapped", source="SKU No."),
        "product_name": _field(status="mapped", source="Article Description"),
        "sku_range": _field(status="mapped", source="MCH"),
        "size": _size_from("Article Description"),
        "brand": _field(status="mapped", source="Brand"),
        "product_category": _field(status="mapped", source="Dept Description"),
        "uom": _PACKS,
        # D2: this column is packs per carton, not pieces per pack.
        "pack_size": _not_in_file("Pack Size here is packs per carton, not pieces per pack."),
        "quantity_units": _field(
            status="mapped",
            melt_group="qty",
            transforms=[{
                "type": "uom_factor",
                "column": "Sales UOM",
                "factors": {"CAR": FAIRPRICE_CAR_FACTOR},
                "default": 1,
            }],
        ),
        "revenue": _field(status="mapped", melt_group="sales"),
    },
    "melt_groups": [
        {
            "id": "sales",
            "select": {"kind": "pattern", "pattern": r"^SALES \| Month \d+ \| \d{2}-\d{2}-\d{4}$"},
            "key": {"target": "period_start", "pattern": r"(\d{2}-\d{2}-\d{4})$", "date_format": "%d-%m-%Y"},
            "value_target": "revenue",
            "period_type": "month",
            **_SURE,
        },
        {
            "id": "qty",
            "select": {"kind": "pattern", "pattern": r"^Qty \(in EA\) \| Month \d+ \| \d{2}-\d{2}-\d{4}$"},
            "key": {"target": "period_start", "pattern": r"(\d{2}-\d{2}-\d{4})$", "date_format": "%d-%m-%Y"},
            "value_target": "quantity_units",
            "period_type": "month",
            **_SURE,
        },
    ],
    # A store can report one SKU under both CAR and EA rows.
    "aggregate": monthly_aggregate(),
    "data_source": "aireos_upload",
}


NHG_SAP = {
    "version": 2,
    "fields": {
        "period_start": _field(status="mapped", source="Posting Date", transforms=[{"type": "month_start"}]),
        "period_type": _field(status="constant", value="month"),
        "retailer": _field(status="constant", value="nhg_offline"),
        "store_code": _not_in_file("NHG reports all stores together; the file has no store."),
        "store_name": _not_in_file("No store in the file."),
        "store_format": _not_in_file("No store in the file."),
        "sku": _field(
            status="mapped", source="Material",
            transforms=[{"type": "value_map", "values": dict(NHG_CODES)}],
        ),
        "product_name": _field(status="mapped", source="Material Description"),
        "sku_range": _not_in_file("No range column."),
        "size": _size_from("Material Description"),
        "brand": _not_in_file("No brand column."),
        "product_category": _not_in_file("No category column."),
        "uom": _PACKS,
        "pack_size": _not_in_file("No pack size column."),
        # SAP posts a sale as a negative quantity; a return is positive and
        # nets off (business rule B5).
        "quantity_units": _field(
            status="mapped", source="Qty in Un. of Entry", transforms=[{"type": "negate"}],
        ),
        "revenue": _not_in_file("NHG files carry quantity only."),
    },
    "melt_groups": [],
    # One row per SAP posting: several a day per SKU, rolled up to the month.
    "aggregate": monthly_aggregate(),
    "data_source": "aireos_upload",
}


SHENG_SIONG_CLAIM = {
    "version": 2,
    "fields": {
        # BusinessDate is merged across each date's rows (the layout fills it
        # down); forward_fill covers a file exported without the merge.
        "period_start": _field(
            status="mapped", source="BusinessDate",
            transforms=[{"type": "forward_fill"}, {"type": "month_start"}],
        ),
        "period_type": _field(status="constant", value="month"),
        # Outlet columns ending _Ecomm are the online channel.
        "retailer": _field(
            status="derived",
            from_field="store_code",
            transforms=[{
                "type": "rules",
                "rules": [{"op": "endswith", "value": "_Ecomm", "output": "sheng_siong_online"}],
                "default": "sheng_siong_offline",
            }],
        ),
        "store_code": _field(status="mapped", melt_group="outlets"),
        "store_name": _not_in_file("Outlets are named by code only."),
        "store_format": _not_in_file("Outlets are named by code only."),
        "sku": _field(
            status="mapped", source="ItemCode",
            transforms=[{"type": "value_map", "values": dict(SHENG_SIONG_CODES)}],
        ),
        "product_name": _field(status="mapped", source="Description"),
        "sku_range": _not_in_file("No range column."),
        "size": _size_from("Description"),
        "brand": _not_in_file("No brand column."),
        "product_category": _not_in_file("No category column."),
        "uom": _PACKS,
        "pack_size": _not_in_file("No pack size column."),
        # Empty crosstab cells are written as 0.
        "quantity_units": _field(
            status="mapped", melt_group="outlets", transforms=[{"type": "zero_as_empty"}],
        ),
        # A promotion claim statement: Supplier Claim is a per-unit amount
        # claimed back from the supplier, never sales value (rule B6).
        "revenue": _not_in_file(
            "Claim statement: Supplier Claim and Contra are claims against the supplier, not sales.",
        ),
    },
    "melt_groups": [
        {
            "id": "outlets",
            "select": {"kind": "between", "after": "OUTLET", "before": "Total"},
            "key": {"target": "store_code"},
            "value_target": "quantity_units",
            **_SURE,
        },
    ],
    # One row per day per SKU, rolled up to the month.
    "aggregate": monthly_aggregate(),
    "data_source": "promo_claim",
}


REFERENCE_CONTRACTS = {
    "fairprice_monthly": {
        "name": "FairPrice monthly sell-out",
        "vendor": "FairPrice",
        "description": "Tab-separated, one row per SKU x store x sales UOM, wide by month.",
        "contract": FAIRPRICE_MONTHLY,
    },
    "nhg_sap": {
        "name": "NHG SAP postings",
        "vendor": "NHG",
        "description": "Workbook whose first sheet is a pivot; the data sheet is one row per SAP posting, sales negative, no store or revenue.",
        "contract": NHG_SAP,
    },
    "sheng_siong_claim": {
        "name": "Sheng Siong claim sales summary",
        "vendor": "Sheng Siong",
        "description": "Promotion claim statement: preamble, header on row 7, merged dates, wide by outlet between OUTLET and Total, footer totals.",
        "contract": SHENG_SIONG_CLAIM,
    },
}


def reference_contract(key: str) -> dict:
    """A copy of one reference contract, safe to modify."""
    return copy.deepcopy(REFERENCE_CONTRACTS[key]["contract"])
