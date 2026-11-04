"""Create isolated Singapore-backed forecast source views for QA.

This never changes the six live Aire_Data_Analytics views. The staging views
use the exact cutover definitions with their internal references redirected to
the staging dataset, so downstream counts can be compared before cutover.
"""

import argparse
import re
import sys
from pathlib import Path

from google.cloud import bigquery

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.bigquery import get_bigquery_client

PROJECT = "aire-data"
LOCATION = "asia-southeast1"
STAGING = f"{PROJECT}.aireos_forecast_validation_sg"
SOURCE = f"{PROJECT}.Aire_Data_Analytics"
VIEW_NAMES = (
    "v_sales_enriched", "v_promotion_events_enriched", "v_inventory_history",
    "v_customer_monthly_sales", "v_promotion_features_monthly",
    "v_forecasting_foundation_monthly",
)
MODEL_INPUT_VIEWS = (
    "fc_promo_calendar_monthly", "fc_training_input", "fc_future_input",
)
SQL_FILE = Path(__file__).resolve().parents[2] / "docs" / "forecast_sg_view_cutover.sql"


def statements() -> list[str]:
    sql = SQL_FILE.read_text(encoding="utf-8")
    sections = re.split(r"(?=^-- v_[a-z_]+$)", sql, flags=re.MULTILINE)
    result = []
    for section in sections:
        if not section.lstrip().startswith("-- v_"):
            continue
        statement = section.split("\n", 1)[1].strip().rstrip(";")
        for name in VIEW_NAMES:
            statement = statement.replace(f"`{SOURCE}.{name}`", f"`{STAGING}.{name}`")
        result.append(statement)
    if len(result) != len(VIEW_NAMES):
        raise ValueError(f"Expected {len(VIEW_NAMES)} view definitions, found {len(result)}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true", help="Create staging dataset and views")
    args = parser.parse_args()
    client = get_bigquery_client()
    queries = statements()
    if not args.create:
        for name, query in zip(VIEW_NAMES, queries):
            print(f"READY {name}: {len(query)} SQL characters")
        for name in MODEL_INPUT_VIEWS:
            print(f"READY {name}: live definition will be copied with staging references")
        print("Pass --create to create only the isolated staging views.")
        return
    dataset = bigquery.Dataset(STAGING)
    dataset.location = LOCATION
    client.create_dataset(dataset, exists_ok=True)
    for name, query in zip(VIEW_NAMES, queries):
        client.query(query, location=LOCATION).result()
        print(f"CREATED {STAGING}.{name}", flush=True)
    for name in MODEL_INPUT_VIEWS:
        query = client.get_table(f"{SOURCE}.{name}").view_query
        for referenced in (*VIEW_NAMES, *MODEL_INPUT_VIEWS):
            query = query.replace(f"`{SOURCE}.{referenced}`", f"`{STAGING}.{referenced}`")
        client.query(
            f"CREATE OR REPLACE VIEW `{STAGING}.{name}` AS {query}", location=LOCATION
        ).result()
        print(f"CREATED {STAGING}.{name}", flush=True)


if __name__ == "__main__":
    main()
