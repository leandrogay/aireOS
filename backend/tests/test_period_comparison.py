import pandas as pd
import pytest

from app.services import bigquery


class FakeQueryJob:
    def __init__(self, df):
        self._df = df

    def result(self):
        return self

    def to_dataframe(self):
        return self._df


class FakeBigQueryClient:
    def __init__(self, df):
        self.df = df
        self.last_query = None
        self.last_job_config = None

    def query(self, query, job_config=None):
        self.last_query = query
        self.last_job_config = job_config
        return FakeQueryJob(self.df)


def _totals_row(current_revenue=0.0, current_units=0.0, previous_revenue=0.0, previous_units=0.0, previous_row_count=0):
    return pd.DataFrame(
        [
            {
                "current_revenue": current_revenue,
                "current_units": current_units,
                "previous_revenue": previous_revenue,
                "previous_units": previous_units,
                "previous_row_count": previous_row_count,
            }
        ]
    )


def _install_fake_bq_client(monkeypatch, df):
    fake_client = FakeBigQueryClient(df)
    monkeypatch.setattr(bigquery, "get_bigquery_client", lambda: fake_client)
    return fake_client


def _fix_anchor(monkeypatch, anchor: str | None):
    ts = pd.Timestamp(anchor) if anchor else None
    monkeypatch.setattr(bigquery, "_latest_week_start", lambda retailer: ts)


# ---- _month_bounds / _year_bounds --------------------------------------------

def test_month_bounds_mid_month_anchor():
    start, end = bigquery._month_bounds(pd.Timestamp("2026-08-17"))
    assert start == pd.Timestamp("2026-08-01")
    assert end == pd.Timestamp("2026-08-31")


def test_month_bounds_leap_year_february():
    start, end = bigquery._month_bounds(pd.Timestamp("2028-02-10"))
    assert start == pd.Timestamp("2028-02-01")
    assert end == pd.Timestamp("2028-02-29")


def test_year_bounds_mid_year_anchor():
    start, end = bigquery._year_bounds(pd.Timestamp("2026-08-17"))
    assert start == pd.Timestamp("2026-01-01")
    assert end == pd.Timestamp("2026-12-31")


# ---- _resolve_preset_range: wow -----------------------------------------------

def test_wow_previous_is_exactly_seven_days_before_current(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")

    cur_start, cur_end, prev_start, prev_end = bigquery._resolve_preset_range("wow", "fairprice_offline")

    assert (cur_start, cur_end) == (pd.Timestamp("2026-08-17"), pd.Timestamp("2026-08-23"))
    assert (prev_start, prev_end) == (pd.Timestamp("2026-08-10"), pd.Timestamp("2026-08-16"))


def test_resolve_preset_range_returns_none_when_no_data(monkeypatch):
    _fix_anchor(monkeypatch, None)

    assert bigquery._resolve_preset_range("wow", "fairprice_offline") is None


# ---- _resolve_preset_range: mom (day-matched truncation) ----------------------

def test_mom_partial_month_truncates_previous_to_same_day_count(monkeypatch):
    # Anchor's week (Aug 17-23) doesn't reach month-end (Aug 31), so current
    # is truncated to Aug 1-23 (23 days) and previous must be the SAME
    # 23-day span from the prior month's start, not the full prior month.
    _fix_anchor(monkeypatch, "2026-08-17")

    cur_start, cur_end, prev_start, prev_end = bigquery._resolve_preset_range("mom", "fairprice_offline")

    assert cur_start == pd.Timestamp("2026-08-01")
    assert cur_end == pd.Timestamp("2026-08-23")
    days_covered = (cur_end - cur_start).days
    assert prev_start == pd.Timestamp("2026-07-01")
    assert prev_end == prev_start + pd.Timedelta(days=days_covered)
    assert (prev_end - prev_start).days == (cur_end - cur_start).days


def test_mom_current_never_extends_past_the_calendar_month(monkeypatch):
    # Anchor's week (Aug 28 - Sep 3) crosses into September, but current
    # must stop at Aug 31 regardless of how far the latest week extends.
    _fix_anchor(monkeypatch, "2026-08-28")

    cur_start, cur_end, _, _ = bigquery._resolve_preset_range("mom", "fairprice_offline")

    assert cur_end == pd.Timestamp("2026-08-31")


def test_mom_handles_january_rolling_back_to_prior_december(monkeypatch):
    _fix_anchor(monkeypatch, "2026-01-05")

    cur_start, cur_end, prev_start, prev_end = bigquery._resolve_preset_range("mom", "fairprice_offline")

    assert cur_start == pd.Timestamp("2026-01-01")
    assert prev_start == pd.Timestamp("2025-12-01")


# ---- _resolve_preset_range: yoy (day-matched truncation, same as mom) ---------

def test_yoy_partial_year_truncates_previous_to_same_day_count(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")

    cur_start, cur_end, prev_start, prev_end = bigquery._resolve_preset_range("yoy", "fairprice_offline")

    assert cur_start == pd.Timestamp("2026-01-01")
    assert cur_end == pd.Timestamp("2026-08-23")
    days_covered = (cur_end - cur_start).days
    assert prev_start == pd.Timestamp("2025-01-01")
    assert (prev_end - prev_start).days == days_covered


def test_yoy_current_never_extends_past_the_calendar_year(monkeypatch):
    _fix_anchor(monkeypatch, "2026-12-29")

    cur_start, cur_end, _, _ = bigquery._resolve_preset_range("yoy", "fairprice_offline")

    assert cur_end == pd.Timestamp("2026-12-31")


# ---- get_default_date_range: quick-range buttons -------------------------------

def test_default_date_range_week_is_the_latest_available_week(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")

    result = bigquery.get_default_date_range(mode="offline", period="week")

    assert result == {"start": "2026-08-17", "end": "2026-08-23"}


def test_default_date_range_month_is_the_full_current_month(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")

    result = bigquery.get_default_date_range(mode="offline", period="month")

    # Deliberately NOT truncated to available data -- a plain display window,
    # unlike the comparison presets above.
    assert result == {"start": "2026-08-01", "end": "2026-08-31"}


def test_default_date_range_six_months_includes_current_month(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")

    result = bigquery.get_default_date_range(mode="offline", period="6months")

    assert result == {"start": "2026-03-01", "end": "2026-08-31"}


def test_default_date_range_twelve_months_includes_current_month(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")

    result = bigquery.get_default_date_range(mode="offline", period="12months")

    assert result == {"start": "2025-09-01", "end": "2026-08-31"}


def test_default_date_range_no_data_returns_none_bounds(monkeypatch):
    _fix_anchor(monkeypatch, None)

    result = bigquery.get_default_date_range(mode="offline", period="month")

    assert result == {"start": None, "end": None}


def test_default_date_range_invalid_period_raises(monkeypatch):
    with pytest.raises(ValueError):
        bigquery.get_default_date_range(period="quarter")


def test_default_date_range_invalid_mode_raises(monkeypatch):
    with pytest.raises(ValueError):
        bigquery.get_default_date_range(mode="retail")


# ---- get_period_comparison: end-to-end shape -----------------------------------

def test_period_comparison_invalid_comparison_type_raises(monkeypatch):
    with pytest.raises(ValueError):
        bigquery.get_period_comparison(comparison_type="qoq")


def test_period_comparison_no_data_for_anchor_returns_empty_shape(monkeypatch):
    _fix_anchor(monkeypatch, None)

    result = bigquery.get_period_comparison(comparison_type="wow")

    assert result["current"]["start"] is None
    assert result["previous"]["available"] is False


def test_period_comparison_wow_reports_available_when_previous_has_rows(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")
    _install_fake_bq_client(
        monkeypatch,
        _totals_row(current_revenue=1000.0, current_units=50, previous_revenue=800.0, previous_units=40, previous_row_count=7),
    )

    result = bigquery.get_period_comparison(comparison_type="wow", mode="offline")

    assert result["current"] == {"start": "2026-08-17", "end": "2026-08-23", "revenue": 1000.0, "units": 50.0}
    assert result["previous"]["start"] == "2026-08-10"
    assert result["previous"]["end"] == "2026-08-16"
    assert result["previous"]["available"] is True


def test_period_comparison_reports_unavailable_when_previous_has_no_rows(monkeypatch):
    _fix_anchor(monkeypatch, "2026-08-17")
    _install_fake_bq_client(monkeypatch, _totals_row(previous_row_count=0))

    result = bigquery.get_period_comparison(comparison_type="wow", mode="offline")

    assert result["previous"]["available"] is False


def test_period_comparison_custom_dates_default_previous_to_one_month_back(monkeypatch):
    _install_fake_bq_client(monkeypatch, _totals_row())

    result = bigquery.get_period_comparison(current_start="2026-08-01", current_end="2026-08-19")

    assert result["previous"]["start"] == "2026-07-01"
    assert result["previous"]["end"] == "2026-07-19"


def test_period_comparison_custom_dates_used_verbatim_when_both_given(monkeypatch):
    _install_fake_bq_client(monkeypatch, _totals_row())

    result = bigquery.get_period_comparison(
        current_start="2026-08-01",
        current_end="2026-08-19",
        previous_start="2025-01-01",
        previous_end="2025-01-19",
    )

    assert result["current"] == {"start": "2026-08-01", "end": "2026-08-19", "revenue": 0.0, "units": 0.0}
    assert result["previous"]["start"] == "2025-01-01"
    assert result["previous"]["end"] == "2025-01-19"
