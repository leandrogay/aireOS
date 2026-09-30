"""
Check that the Tier 0 SQL matches pl_forecast.py on live data.

Runs the SELECT inside bigquery/views/010_create_tier0_legacy_forecasts_view.sql
as a read-only query (nothing is created in BigQuery), then recomputes the
latest and holdout origins with pl_forecast.forecast_sku and compares them.
The SQL has no promotion uplift, so pl_forecast is run with none either.
Needs BigQuery credentials, so it is a manual check, not a pytest.

Run from backend/ with the venv active:

    python scripts/check_tier0_parity.py
"""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import pl_forecast
from app.services.bigquery import get_bigquery_client

VIEW_SQL = Path(__file__).resolve().parents[2] / "bigquery" / "views" / "010_create_tier0_legacy_forecasts_view.sql"
TRAINING_INPUT = "aire-data.Aire_Data_Analytics.fc_training_input"
LOCATION = "asia-southeast1"
# BigQuery ROUND is half away from zero, pandas rounds half to even.
TOLERANCE_CARTONS = 1.0


def _view_select() -> str:
    sql = VIEW_SQL.read_text()
    return sql[sql.index(" AS\nWITH params AS") + len(" AS\n"):]


def _query(sql: str) -> pd.DataFrame:
    return get_bigquery_client().query(sql, location=LOCATION).result().to_dataframe()


def _history() -> pd.DataFrame:
    df = _query(f"SELECT customer_id, sku, month_year, quantity_cartons FROM `{TRAINING_INPUT}`")
    df["month_year"] = pd.to_datetime(df["month_year"]).dt.to_period("M")
    return df


def _python_forecast(history: pd.DataFrame, sql_rows: pd.DataFrame, origin: pd.Period) -> pd.DataFrame:
    params = pl_forecast.ForecastParams()
    known = history[history["month_year"] <= origin]
    results = []
    for (customer_id, sku), target in sql_rows.groupby(["customer_id", "sku"]):
        series = known[(known["customer_id"] == customer_id) & (known["sku"] == sku)]
        # forecast_sku's names: quantity_units, promo_type (None = no uplift).
        series = (series.rename(columns={"quantity_cartons": "quantity_units"})
                  .assign(promo_type=None)
                  .set_index("month_year")
                  .sort_index())
        months = list(pd.period_range(series.index.max() + 1, target["month_period"].max(), freq="M"))
        forecast = pl_forecast.forecast_sku(series, {}, months, {}, params)
        forecast["customer_id"] = customer_id
        forecast["sku"] = sku
        results.append(forecast)
    python = pd.concat(results, ignore_index=True)
    python["python_cartons"] = python["total_sell_out"].round()
    return python.rename(columns={"month_year": "month_period"})


def main() -> None:
    history = _history()
    sql = _query(_view_select())
    sql["month_period"] = pd.to_datetime(sql["month_year"]).dt.to_period("M")
    sql["origin_period"] = pd.to_datetime(sql["origin_month"]).dt.to_period("M")

    last = history["month_year"].max()
    failed = False
    for label, origin in (("latest origin", last), ("holdout origin", last - 3)):
        rows = sql[sql["origin_period"] == origin]
        python = _python_forecast(history, rows, origin)
        merged = rows.merge(python, on=["customer_id", "sku", "month_period"], how="left")
        merged["diff"] = (merged["predicted_quantity_cartons"] - merged["python_cartons"]).abs()
        mismatches = merged[merged["diff"].isna() | (merged["diff"] > TOLERANCE_CARTONS)]
        print(f"{label} {origin}: {len(merged)} rows, {len(mismatches)} mismatches")
        if not mismatches.empty:
            failed = True
            print(mismatches[["sku", "month_period", "predicted_quantity_cartons", "python_cartons",
                              "base_method_x", "base_method_y"]].to_string(index=False))

    print(f"{sql['origin_month'].nunique()} origins, {len(sql)} rows in the view")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
