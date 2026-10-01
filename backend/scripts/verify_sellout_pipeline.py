"""Read-only operational checks for the Cloud SQL sell-out pipeline."""

import datetime
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import sql


def main() -> None:
    try:
        engine = sql.connect_with_connector_autocommit()
        with engine.connect() as connection:
            identity = connection.execute(
                text(
                    """
                    SELECT
                        current_database() AS database_name,
                        current_user AS connected_user
                    """
                )
            ).mappings().one()

            schema = connection.execute(
                text(
                    """
                    SELECT table_name, column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name IN ('sellout', 'skus', 'stores', 'retailers')
                    ORDER BY table_name, ordinal_position
                    """
                )
            ).mappings().all()

            permissions = connection.execute(
                text(
                    """
                    SELECT
                        has_table_privilege(current_user, 'public.sellout', 'INSERT')
                            AS sellout_insert,
                        has_table_privilege(current_user, 'public.sellout', 'UPDATE')
                            AS sellout_update,
                        has_table_privilege(current_user, 'public.sellout', 'DELETE')
                            AS sellout_delete,
                        has_table_privilege(current_user, 'public.skus', 'INSERT')
                            AS skus_insert,
                        has_table_privilege(current_user, 'public.stores', 'INSERT')
                            AS stores_insert,
                        has_table_privilege(current_user, 'public.retailers', 'INSERT')
                            AS retailers_insert
                    """
                )
            ).mappings().one()

            constraints = connection.execute(
                text(
                    """
                    SELECT
                        relation.relname AS table_name,
                        constraint_row.conname AS constraint_name,
                        pg_get_constraintdef(constraint_row.oid) AS definition
                    FROM pg_constraint AS constraint_row
                    JOIN pg_class AS relation
                      ON relation.oid = constraint_row.conrelid
                    JOIN pg_namespace AS namespace
                      ON namespace.oid = relation.relnamespace
                    WHERE namespace.nspname = 'public'
                      AND relation.relname IN ('sellout', 'skus', 'stores', 'retailers')
                      AND constraint_row.contype IN ('p', 'u')
                    ORDER BY relation.relname, constraint_row.conname
                    """
                )
            ).mappings().all()

            august = connection.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE period_type = 'week')
                            AS august_week_rows,
                        COUNT(*) FILTER (WHERE period_type = 'month')
                            AS august_month_rows
                    FROM public.sellout
                    WHERE period_start BETWEEN :start_date AND :end_date
                    """
                ),
                {
                    "start_date": datetime.date(2026, 8, 1),
                    "end_date": datetime.date(2026, 8, 31),
                },
            ).mappings().one()

        print(dict(identity))
        print(f"verified_schema_columns={len(schema)}")
        print(dict(permissions))
        print([dict(row) for row in constraints])
        print(dict(august))
    finally:
        sql.close_database()


if __name__ == "__main__":
    main()
