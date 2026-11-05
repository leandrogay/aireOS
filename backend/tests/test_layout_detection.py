"""
Finding the data table inside a retailer file.

The promise: whatever the workbook opens on, the rows handed to the mapping
are the data rows -- not a pivot summary, not a title, not the footer totals --
and what was set aside is described so it can be checked against.
"""

import io

import openpyxl
import pytest
from conftest import fairprice_txt, nhg_xlsx, sheng_siong_xlsx, singhealth_xlsx

from app.services import layout_detection as ld


# ---- Choosing the sheet -----------------------------------------------------------

def test_a_pivot_sheet_is_rejected_and_the_data_sheet_chosen():
    frame, layout = ld.read_table("nhg.xlsx", nhg_xlsx(pivot_first=True))

    assert layout["sheet"] == "Sheet1"
    assert layout["rejected_sheets"] == [{"name": "Sheet2", "reason": "pivot table"}]
    assert list(frame.columns) == ["Posting Date", "Material", "Material Description", "Qty in Un. of Entry"]
    assert len(frame) == 4


def test_the_data_sheet_is_found_whatever_the_sheet_order():
    _, layout = ld.read_table("nhg.xlsx", nhg_xlsx(pivot_first=False))

    assert layout["sheet"] == "Sheet1"


def test_a_pivot_grand_total_is_kept_for_reconciliation():
    _, layout = ld.read_table("nhg.xlsx", nhg_xlsx())

    assert layout["pivot_totals"] == [{"sheet": "Sheet2", "column": "Qty in Un. of Entry", "total": -13.0}]


def test_a_workbook_with_only_a_pivot_is_unreadable():
    workbook = openpyxl.Workbook()
    workbook.active.append(["Row Labels", "Sum of Qty"])
    workbook.active.append(["A", 1])
    buffer = io.BytesIO()
    workbook.save(buffer)

    with pytest.raises(ld.LayoutError):
        ld.read_table("pivot.xlsx", buffer.getvalue())


def test_a_grand_total_footer_alone_does_not_make_a_sheet_a_pivot():
    data = b"Store,Qty\nA,1\nB,2\nGrand Total,3\n"

    frame, layout = ld.read_table("plain.csv", data)

    assert len(frame) == 2
    assert layout["footer_rows"][0]["label"] == "Grand Total"


# ---- Header, preamble, footers ------------------------------------------------------

def test_the_header_is_found_below_a_title_and_key_value_lines():
    _, layout = ld.read_table("ss.xlsx", sheng_siong_xlsx())

    assert layout["header_row"] == 7
    assert layout["title"] == "CLAIM SALES SUMMARY FOR 1/6/2026 TO 30/6/2026"
    assert layout["metadata"]["RefNo"] == "P100045355"
    assert layout["metadata"]["Supplier Code"] == "XLPL"


def test_the_period_stated_in_the_title_is_read_day_first():
    _, layout = ld.read_table("ss.xlsx", sheng_siong_xlsx())

    assert layout["stated_period"]["start"] == "2026-06-01"
    assert layout["stated_period"]["end"] == "2026-06-30"


def test_header_whitespace_is_normalised():
    frame, _ = ld.read_table("ss.xlsx", sheng_siong_xlsx())

    assert "BusinessDate" in frame.columns
    assert "Total" in frame.columns
    assert "BusinessDate " not in frame.columns


def test_footer_rows_are_excluded_from_data_and_kept():
    frame, layout = ld.read_table("ss.xlsx", sheng_siong_xlsx())

    assert len(frame) == 3
    assert [row["label"] for row in layout["footer_rows"]] == [
        "Total", "Total Claim before GST", "Total Claim After GST",
    ]
    assert layout["footer_rows"][0]["values"]["Total"] == "10"


def test_claim_lines_under_the_total_are_footers_whatever_their_label():
    frame, layout = ld.read_table("ss.xlsx", sheng_siong_xlsx(claim_label="Supplier Claim"))

    assert len(frame) == 3
    assert frame["ItemCode"].notna().all()
    assert [row["label"] for row in layout["footer_rows"]] == [
        "Total", "Supplier Claim before GST", "Supplier Claim After GST",
    ]


def test_a_summary_line_with_no_total_above_it_stays_data():
    data = b"Date,Code,Qty\n2026-08-01,A1,3\n,Adjustment,1\n"

    frame, layout = ld.read_table("adj.csv", data)

    assert len(frame) == 2
    assert layout["footer_rows"] == []


def test_a_period_stated_with_month_names_is_read():
    _, layout = ld.read_table("XEL.xlsx", singhealth_xlsx())

    assert layout["stated_period"]["start"] == "2026-08-01"
    assert layout["stated_period"]["end"] == "2026-08-31"


def test_the_cells_above_the_header_are_kept_by_column():
    _, layout = ld.read_table("XEL.xlsx", singhealth_xlsx())

    assert layout["header_row"] == 4
    codes = next(item for item in layout["rows_above_header"] if item["row"] == 3)
    assert codes["cells"] == {"BEDOK": "81001", "ONLINE": "88001"}


def test_merged_date_cells_are_filled_down():
    frame, layout = ld.read_table("ss.xlsx", sheng_siong_xlsx())

    assert frame["BusinessDate"].tolist() == ["2026-06-01", "2026-06-01", "2026-06-02"]
    assert layout["filled_columns"] == ["BusinessDate"]


def test_spacer_and_total_columns_are_identified():
    _, layout = ld.read_table("ss.xlsx", sheng_siong_xlsx())

    assert layout["spacer_columns"] == ["OUTLET"]
    assert layout["total_columns"] == ["Total"]


# ---- Text files ----------------------------------------------------------------------

def test_a_tab_separated_file_keeps_identifiers_as_text_and_blanks_as_none():
    frame, layout = ld.read_table("fp.txt", fairprice_txt())

    assert layout["header_row"] == 1
    assert frame.loc[0, "SKU No."] == "13255043"
    assert frame.loc[1, "SALES | Month 2 | 01-02-2026"] is None


def test_a_csv_preamble_line_shorter_than_the_header_does_not_break_the_read():
    data = b"Sales report\nStore,SKU,Qty\nA,1,5\nB,2,6\n"

    frame, layout = ld.read_table("report.csv", data)

    assert layout["header_row"] == 2
    assert layout["title"] == "Sales report"
    assert list(frame.columns) == ["Store", "SKU", "Qty"]


def test_an_unsupported_extension_is_refused():
    with pytest.raises(ld.LayoutError):
        ld.read_table("report.pdf", b"%PDF")
