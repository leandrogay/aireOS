"""
Shared fakes for the Cloud SQL services.

FakeConnection stands in for a SQLAlchemy Connection: it records
every statement and its bound parameters, and answers each one
from a caller-supplied `respond(sql, params)` function so a test
can assert on the contract (parameters, statement count) without
a database.

FrozenDatetime pins the clock for the UTC tests.
"""

import datetime

import pytest

from app import config


@pytest.fixture(autouse=True)
def disable_authentication_by_default(monkeypatch):
    """Keep domain tests independent of a developer's local SSO setting."""
    monkeypatch.setattr(config, "AUTH_ENABLED", "false")


class FakeResult:
    def __init__(self, rows):
        self._rows = list(rows)
        # Matches real SQLAlchemy's rowcount for an UPDATE/DELETE: how many
        # rows the statement affected. A respond() for such a statement
        # returns the affected rows (even if the caller discards them).
        self.rowcount = len(self._rows)

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._rows[0][0] if self._rows else None

    def scalar_one(self):
        return self._rows[0][0]

    def scalars(self):
        return FakeResult([row[0] for row in self._rows])

    def mappings(self):
        return FakeResult([dict(row) for row in self._rows])


class FakeConnection:
    """Records (sql, params) calls; `respond` decides what each returns."""

    def __init__(self, respond=None):
        self.calls = []
        self._respond = respond or (lambda sql, params: [])

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        self.calls.append((sql, params))
        return FakeResult(self._respond(sql, params))

    def sql_containing(self, fragment):
        return [
            (sql, params)
            for sql, params in self.calls
            if fragment in sql
        ]


class FakeEngine:
    """Hands the same FakeConnection back from begin() and connect()."""

    def __init__(self, conn):
        self.conn = conn

    def begin(self):
        return self

    def connect(self):
        return self

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


# ---- Clock ----------------------------------------------------------------

# 30 Sep 17:00 UTC is already 1 Oct 01:00 in Singapore, so the UTC day and
# the Singapore day differ: the case where a server-local clock gives itself away.
FROZEN_UTC = datetime.datetime(2026, 9, 30, 17, 0, tzinfo=datetime.timezone.utc)
SINGAPORE = datetime.timezone(datetime.timedelta(hours=8))


class FrozenDatetime(datetime.datetime):
    """datetime.datetime stuck at FROZEN_UTC, on a server whose local clock is Singapore time."""

    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return FROZEN_UTC.astimezone(SINGAPORE).replace(tzinfo=None)
        return FROZEN_UTC.astimezone(tz)


# ---- No real notifications --------------------------------------------------

@pytest.fixture(autouse=True)
def _no_real_notification_database(monkeypatch):
    """
    Uploads and mapping approvals write a notification of their own, outside
    any engine a test fakes. Without this, a test of one of them would open a
    real Cloud SQL connection on any machine that has credentials. Tests that
    exercise notification_service install their own fake engine over this.
    """

    from app.services import notification_service

    def blocked():
        raise AssertionError("tests must not reach the real notifications table")

    monkeypatch.setattr(notification_service, "_get_engine", blocked)
    monkeypatch.setattr(notification_service, "_get_read_engine", blocked)


# ---- Synthetic retailer files -----------------------------------------------
#
# Small copies of the real layouts (FairPrice, NHG, Sheng Siong, SingHealth,
# Prime), built in memory. The real sample files are commercial data and never
# in git, so CI exercises every layout trait through these instead: NHG's pivot
# sheet first, Sheng Siong's preamble / merged dates / spacer / total column /
# footers, FairPrice's CAR + EA rows and blank cells, SingHealth's stated
# period and outlet codes above the header.

import io

import openpyxl
import pytest

FAIRPRICE_MONTHS = ["01-01-2026", "01-02-2026"]


def fairprice_txt(months=FAIRPRICE_MONTHS) -> bytes:
    """Two SKUs at two stores (one online), wide by month, a CAR and an EA row for one store."""
    header = [
        "Vendor Code", "Vendor Name", "Dept Description", "MCH", "SKU No.", "Article Description",
        "Sales UOM", "Pack Size", "Store Code", "Store Name", "Store Format",
    ]
    header += [f"SALES | Month {n} | {date}" for n, date in enumerate(months, start=1)]
    header += [f"Qty (in EA) | Month {n} | {date}" for n, date in enumerate(months, start=1)]
    rows = [
        ["73697", "XEL LIFECARE PTE LTD", "TOILETRIES", "ADULT DIAPER PANTS", "13255043", "AIRE ADULT PANTS XL 10S", "EA", "8", "4", "FAIRPRICE ON", "FPON", "100.00", "50.00", "10", "5"],
        ["73697", "XEL LIFECARE PTE LTD", "TOILETRIES", "ADULT DIAPER PANTS", "13255043", "AIRE ADULT PANTS XL 10S", "CAR", "8", "4", "FAIRPRICE ON", "FPON", "90.00", "", "10", ""],
        ["73697", "XEL LIFECARE PTE LTD", "TOILETRIES", "ADULT DIAPER PANTS", "13255044", "AIRE ADULT PANTS S/M 10S", "EA", "8", "358", "TAMPINES MALL", "SUPER", "", "24.00", "", "2"],
    ]
    lines = ["\t".join(header)] + ["\t".join(row) for row in rows]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _workbook_bytes(workbook) -> bytes:
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def nhg_xlsx(pivot_first: bool = True, extra_material: str | None = None) -> bytes:
    """A pivot summary sheet and a data sheet of SAP postings (sales negative, one return)."""
    workbook = openpyxl.Workbook()
    pivot = workbook.active
    pivot.title = "Sheet2"
    pivot.append([None, None])
    pivot.append([None, None])
    pivot.append(["Row Labels", "Sum of Qty in Un. of Entry"])
    pivot.append(["AIRE ADULT PULL UP PANTS L 10S", -9])
    pivot.append(["AIRE ADULT PULL UP PANTS XL 10S", -4])
    total = -13 + (-2 if extra_material else 0)
    pivot.append(["Grand Total", total])

    data = workbook.create_sheet("Sheet1")
    data.append(["Posting Date", "Material", "Material Description", "Qty in Un. of Entry"])
    import datetime as _dt
    data.append([_dt.datetime(2026, 8, 1), "0059-01-025-R", "AIRE ADULT PULL UP PANTS L 10S", -8])
    data.append([_dt.datetime(2026, 8, 1), "0059-01-025-R", "AIRE ADULT PULL UP PANTS L 10S", -3])
    data.append([_dt.datetime(2026, 8, 25), "0059-01-025-R", "AIRE ADULT PULL UP PANTS L 10S", 2])
    data.append([_dt.datetime(2026, 8, 31), "0059-01-027-R", "AIRE ADULT PULL UP PANTS XL 10S", -4])
    if extra_material:
        data.append([_dt.datetime(2026, 8, 31), extra_material, "AIRE ULTRA PROTECT ADULT PANTS XL 12S", -2])
    if not pivot_first:
        workbook.move_sheet("Sheet1", offset=-1)
    return _workbook_bytes(workbook)


SHENG_SIONG_OUTLETS = ["2A", "6M_Ecomm", "TC"]


def sheng_siong_xlsx(outlets=SHENG_SIONG_OUTLETS, claim_label: str = "Total Claim") -> bytes:
    """
    A claim statement: title, key-value preamble, header on row 7, merged dates,
    footers. Newer statements label the claim lines "Supplier Claim ..." instead.
    """
    import datetime as _dt
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Supplier"
    width = 6 + len(outlets) + 1
    sheet.append(["CLAIM SALES SUMMARY FOR 1/6/2026 TO 30/6/2026"])
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=width)
    sheet.append(["RefNo", ": P100045355"])
    sheet.append(["Buyer Code", ": CSTANG"])
    sheet.append(["Supplier Code", ": XLPL"])
    sheet.append(["Creation Date", ": 2026-07-03 12:36:42"])
    sheet.append([])
    sheet.append(["BusinessDate ", "ItemCode ", "Description ", "Contra ", "Supplier Claim ", "OUTLET ", *outlets, "Total "])

    # Each row's cells, one per outlet: 2A, 6M_Ecomm, TC (extra outlets sell 1).
    blocks = [
        (_dt.datetime(2026, 6, 1), [
            (1909284, "AIRE AD P/UP PANTS-L 1X10", 2.14, [1, 0, 2]),
            (1909280, "AIRE ULTRA TAPE DIAPERS L", 1.46, [0, 3, 0]),
        ]),
        (_dt.datetime(2026, 6, 2), [
            (1909284, "AIRE AD P/UP PANTS-L 1X10", 2.14, [0, 0, 4]),
        ]),
    ]
    row_number = 8
    footer = [0] * len(outlets)
    for date, items in blocks:
        first = row_number
        for index, (code, description, claim, cells) in enumerate(items):
            cells = cells + [1] * (len(outlets) - len(cells))
            footer = [a + b for a, b in zip(footer, cells)]
            sheet.append([date if index == 0 else None, code, description, "CMM", claim, None, *cells, sum(cells)])
            row_number += 1
        if row_number - first > 1:
            sheet.merge_cells(start_row=first, start_column=1, end_row=row_number - 1, end_column=1)
    sheet.append(["Total ", None, None, None, None, None, *footer, sum(footer)])
    sheet.append([None, None, None, None, None, f"{claim_label} before GST", *[1.0] * len(outlets), 9.99])
    sheet.append([None, None, None, None, None, f"{claim_label} After GST", *[1.1] * len(outlets), 10.89])
    return _workbook_bytes(workbook)


SINGHEALTH_OUTLETS = [("81001", "BEDOK"), ("88001", "ONLINE")]


def singhealth_xlsx(outlets=SINGHEALTH_OUTLETS, period: str = "01 Aug 2026 TO 31 Aug 2026") -> bytes:
    """An ER130 report: title and period lines, outlet codes above the header naming the outlets, unit costs."""
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["Report : ER130 Sales Report Qty", "Printed by : Someone 09/02/26 12:41:15 PM"])
    sheet.append([f"DATE : {period}"])
    sheet.append([None] * 6 + [int(code) if code else None for code, _ in outlets])
    sheet.append(["Product Code", "Product Name", "Vendor code", "Vendor Name", "Normal cost", "Promo cost", *[name for _, name in outlets]])
    rows = [
        ("0600-08-458-D", "AIRE ADULT PULL UP PANTS S/M 10S^", 7.15, 5.85, [2, 40]),
        ("0600-08-466-D", "AIRE ADULT TAPE ULTRA XL 12S^", 9.5, 8.95, [0, 3]),
    ]
    for code, name, normal, promo, cells in rows:
        cells = cells + [1] * (len(outlets) - len(cells))
        sheet.append([code, name, 1000039995, "XEL LIFECARE PTE. LTD.^", normal, promo, *cells])
    return _workbook_bytes(workbook)


def prime_xlsx() -> bytes:
    """A withdrawal report: one row per pallet sent from the distribution centre to an outlet."""
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append([
        "Delivery Date", "Supplier Code", "Supplier Name", "Product Code", "Product Description",
        "Product Category", "Total Shipped Qty", "Total Shipped Qty UOM", "Total Shipped Qty (CTN)",
        "Pack Size", "Customer code", "Pallet ID",
    ])
    sheet.append(["2026-08-07", "X007", "XEL LIFECARE PTE LTD (DC)", "0303001303", "AIRE ADULT PULL PANTS (L)", "0303", 8, "1X10S", 1, 8, "106", "T1"])
    sheet.append(["2026-08-23", "X007", "XEL LIFECARE PTE LTD (DC)", "0303001303", "AIRE ADULT PULL PANTS (L)", "0303", 16, "1X10S", 2, 8, "106", "T2"])
    sheet.append(["2026-08-20", "X007", "XEL LIFECARE PTE LTD (DC)", "0303001304", "AIRE ADULT PULL PANTS (S/M)", "0303", 32, "1X10S", 4, 8, "WLM", "T3"])
    return _workbook_bytes(workbook)


@pytest.fixture
def retailer_files():
    """(filename, bytes) for each synthetic layout, keyed by reference contract."""
    return {
        "fairprice_monthly": ("XEL_VENDORS_BRANDS_MONTH_01-01-2026_01-02-2026_1.txt", fairprice_txt()),
        "nhg_sap": ("Aire Sell Out Aug 26.xlsx", nhg_xlsx()),
        "sheng_siong_claim": ("Claim_Sales_Summary_Report_XLPL_CSTANG_P100045355_03JUL26.xlsx", sheng_siong_xlsx()),
        "singhealth_er130": ("XEL.xlsx", singhealth_xlsx()),
        "prime_jkdc": ("XEL Lifecare JKDC Withdrawal Report (Aug'26).xlsx", prime_xlsx()),
    }
