from app.services.generate_mapping import validate_contract


RAW_COLUMNS = [
    "SKU",
    "Sales | Week 1 | 01-01-2026",
    "Qty | Week 1 | 01-01-2026",
]
TARGET_SCHEMA = ["sku", "revenue", "quantity_units"]


def _contract(revenue_pattern, quantity_pattern):
    return {
        "identity_mapping": {"SKU": "sku"},
        "melt_groups": [
            {
                "target_field": "revenue",
                "columns": ["Sales | Week 1 | 01-01-2026"],
                "period_extract_regex": revenue_pattern,
                "date_format": "%d-%m-%Y",
            },
            {
                "target_field": "quantity_units",
                "columns": ["Qty | Week 1 | 01-01-2026"],
                "period_extract_regex": quantity_pattern,
                "date_format": "%d-%m-%Y",
            },
        ],
    }


def test_scoped_regexes_produce_no_ambiguity_warning():
    contract = _contract(
        r"Sales \| Week \d+ \| (\d{2}-\d{2}-\d{4})$",
        r"Qty \| Week \d+ \| (\d{2}-\d{2}-\d{4})$",
    )

    result = validate_contract(contract, RAW_COLUMNS, TARGET_SCHEMA)

    assert len(result["melt_groups"]) == 2
    assert not any("also matches" in w for w in result["warnings"])


def test_unscoped_shared_regex_is_flagged_as_ambiguous():
    # Both groups extract the date the same generic way, so this regex would
    # also match the other group's own column -- fine against this exact
    # file (literal columns still disambiguate it), but a future reapply
    # against a differently-dated file could misclassify columns.
    contract = _contract(r"(\d{2}-\d{2}-\d{4})$", r"(\d{2}-\d{2}-\d{4})$")

    result = validate_contract(contract, RAW_COLUMNS, TARGET_SCHEMA)

    assert len(result["melt_groups"]) == 2
    assert any("also matches" in w for w in result["warnings"])
