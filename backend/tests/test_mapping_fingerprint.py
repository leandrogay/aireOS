from app.services.generate_mapping import fingerprint


def _wide_columns(periods):
    columns = ["SKU No.", "Brand", "Store Code"]
    for number, date in periods:
        columns.append(f"SALES | Week {number} | {date}")
    for number, date in periods:
        columns.append(f"Qty (in EA) | Week {number} | {date}")
    return columns


def test_same_template_different_date_range_fingerprints_identically():
    six_weeks = _wide_columns([(n, d) for n, d in zip(
        range(1, 7),
        ["01-01-2026", "08-01-2026", "15-01-2026", "22-01-2026", "29-01-2026", "05-02-2026"],
    )])
    thirty_one_weeks = _wide_columns([(n, f"{n:02d}-01-2026") for n in range(1, 32)])

    assert fingerprint(six_weeks) == fingerprint(thirty_one_weeks)


def test_same_template_different_raw_punctuation_fingerprints_identically():
    pipe_style = ["SKU No.", "SALES | Week 1 | 01-01-2026", "Qty (in EA) | Week 1 | 01-01-2026"]
    snake_style = ["sku_no", "sales_week_1_01_01_2026", "qty_in_ea_week_1_01_01_2026"]

    assert fingerprint(pipe_style) == fingerprint(snake_style)


def test_genuinely_different_columns_fingerprint_differently():
    fairprice = _wide_columns([(1, "01-01-2026")])
    other_retailer = ["Item Code", "Store No.", "Units Sold"]

    assert fingerprint(fairprice) != fingerprint(other_retailer)


def test_column_order_does_not_affect_fingerprint():
    columns = _wide_columns([(1, "01-01-2026"), (2, "08-01-2026")])

    assert fingerprint(columns) == fingerprint(list(reversed(columns)))
