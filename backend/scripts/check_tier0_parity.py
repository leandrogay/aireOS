"""
Check that the Tier 0 SQL matches pl_forecast.py on live data.

Runs the SELECT inside bigquery/views/010_create_tier0_legacy_forecasts_view.sql
as a read-only query (nothing is created in BigQuery), then recomputes the same
origins with pl_forecast.forecast_sku / estimate_uplifts and compares them.

Live FairPrice data has a promotion every month, so every uplift is 0 there.
A second pass feeds the same SQL a small made-up history with promotion-free
months, so the uplift path is compared too.
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
FUTURE_INPUT = "aire-data.Aire_Data_Analytics.fc_future_input"
LOCATION = "asia-southeast1"
# BigQuery ROUND is half away from zero, pandas rounds half to even.
TOLERANCE_CARTONS = 1.0


def _view_select() -> str:
    sql = VIEW_SQL.read_text()
    return sql[sql.index(" AS\nWITH params AS") + len(" AS\n"):]


def _query(sql: str) -> pd.DataFrame:
    return get_bigquery_client().query(sql, location=LOCATION).result().to_dataframe()


def _synthetic_training() -> pd.DataFrame:
    # Two series over 20 months: promotions most months, some promotion-free
    # neighbours, so 'monthly_only' and 'both_promos' each get 3+ comparisons.
    rows = []
    months = pd.period_range("2025-01", "2026-08", freq="M")
    for sku, scale in (("A", 100.0), ("B", 40.0)):
        for i, month in enumerate(months):
            promo = ("no_promos", "monthly_only", "no_promos", "both_promos")[i % 4]
            lift = {"no_promos": 1.0, "monthly_only": 1.3, "both_promos": 1.6}[promo]
            rows.append({"customer_id": 1, "sku": sku, "month_year": month.start_time.date(),
                         "quantity_cartons": round(scale * (1 + i / 40) * lift, 1), "promo_mix": promo})
    return pd.DataFrame(rows)


def _as_sql_rows(df: pd.DataFrame, columns: dict[str, str]) -> str:
    structs = []
    for record in df.to_dict(orient="records"):
        values = []
        for column, kind in columns.items():
            value = record[column]
            values.append(f"DATE '{value}' AS {column}" if kind == "date"
                          else f"'{value}' AS {column}" if kind == "string"
                          else f"{value} AS {column}")
        structs.append("STRUCT(" + ", ".join(values) + ")")
    return "(SELECT * FROM UNNEST([" + ",\n".join(structs) + "]))"


def _synthetic_view_select(training: pd.DataFrame) -> str:
    last = pd.Period(max(training["month_year"]), "M")
    future = pd.DataFrame([
        {"customer_id": 1, "sku": sku, "month_year": (last + h).start_time.date(),
         "promo_mix": ("monthly_only", "both_promos", "no_promos")[h % 3]}
        for sku in training["sku"].unique() for h in range(1, 14)
    ])
    training_sql = _as_sql_rows(training, {"customer_id": "int", "sku": "string", "month_year": "date",
                                           "quantity_cartons": "float", "promo_mix": "string"})
    future_sql = _as_sql_rows(future, {"customer_id": "int", "sku": "string", "month_year": "date",
                                       "promo_mix": "string"})
    return (_view_select()
            .replace(f"`{TRAINING_INPUT}`", training_sql)
            .replace(f"`{FUTURE_INPUT}`", future_sql))


def _live_training() -> pd.DataFrame:
    return _query(f"SELECT customer_id, sku, month_year, quantity_cartons, promo_mix FROM `{TRAINING_INPUT}`")


def _history(df: pd.DataFrame) -> pd.DataFrame:
    # pl_forecast's names: series = product_name x customer_name, promo = promo_type.
    return pd.DataFrame({
        "product_name": df["sku"],
        "customer_name": df["customer_id"].astype(str),
        "month_year": pd.to_datetime(df["month_year"]).dt.to_period("M"),
        "quantity_units": df["quantity_cartons"].astype(float),
        # 'no_promos' is the absence of a promotion, which pl_forecast spells None.
        "promo_type": df["promo_mix"].where(df["promo_mix"] != "no_promos", None),
    })


def _python_forecast(history: pd.DataFrame, sql_rows: pd.DataFrame, origin: pd.Period) -> pd.DataFrame:
    params = pl_forecast.ForecastParams()
    known = history[history["month_year"] <= origin]
    uplifts = pl_forecast.estimate_uplifts(known, params)

    results = []
    for (sku, customer), target in sql_rows.groupby(["sku", "customer_name"]):
        series = known[(known["product_name"] == sku) & (known["customer_name"] == customer)]
        series = series.set_index("month_year").sort_index()
        promo_by_month = dict(zip(target["month_period"], target["promo_type"]))
        months = list(pd.period_range(series.index.max() + 1, target["month_period"].max(), freq="M"))
        forecast = pl_forecast.forecast_sku(series, promo_by_month, months, uplifts, params)
        forecast["sku"] = sku
        forecast["customer_name"] = customer
        results.append(forecast)
    python = pd.concat(results, ignore_index=True)
    python["python_cartons"] = python["total_sell_out"].round()
    return python.rename(columns={"month_year": "month_period"})


def _compare(label: str, training: pd.DataFrame, view_select: str) -> bool:
    history = _history(training)
    sql = _query(view_select)
    sql["month_period"] = pd.to_datetime(sql["month_year"]).dt.to_period("M")
    sql["origin_period"] = pd.to_datetime(sql["origin_month"]).dt.to_period("M")
    sql["customer_name"] = sql["customer_id"].astype(str)
    sql["promo_type"] = sql["promo_mix"].where(sql["promo_mix"] != "no_promos", None)

    last = history["month_year"].max()
    ok = True
    for origin_label, origin in (("latest origin", last), ("holdout origin", last - 3)):
        rows = sql[sql["origin_period"] == origin]
        python = _python_forecast(history, rows, origin)
        merged = rows.merge(python, on=["sku", "customer_name", "month_period"], how="left")
        merged["diff"] = (merged["predicted_quantity_cartons"] - merged["python_cartons"]).abs()
        mismatches = merged[merged["diff"].isna() | (merged["diff"] > TOLERANCE_CARTONS)]
        uplifted = int((merged["sell_out_building_blocks_x"] > 0).sum())
        print(f"{label}, {origin_label} {origin}: {len(merged)} rows, "
              f"{uplifted} with uplift, {len(mismatches)} mismatches")
        if not mismatches.empty:
            ok = False
            print(mismatches[["sku", "month_period", "predicted_quantity_cartons", "python_cartons",
                              "base_method_x", "base_method_y"]].to_string(index=False))
    return ok


def main() -> None:
    live = _compare("live data", _live_training(), _view_select())
    synthetic_training = _synthetic_training()
    synthetic = _compare("synthetic promos", synthetic_training, _synthetic_view_select(synthetic_training))
    sys.exit(0 if live and synthetic else 1)


if __name__ == "__main__":
    main()
