import os
from pathlib import Path
from threading import Lock

import pg8000
import sqlalchemy
from dotenv import load_dotenv
from google.cloud.sql.connector import Connector, IPTypes
from google.oauth2 import service_account
from sqlalchemy.engine import Engine


ENV_PATH = Path(__file__).resolve().parents[2]
load_dotenv(ENV_PATH)


_engine: Engine | None = None
_connector: Connector | None = None
_lock = Lock()


def connect_with_connector() -> Engine:
    """
    Returns a shared SQLAlchemy Engine.

    The engine owns a connection pool, so it should be created once
    and reused across API requests.
    """

    global _engine
    global _connector

    if _engine is not None:
        return _engine

    with _lock:
        # Another thread may have created it while waiting for the lock.
        if _engine is not None:
            return _engine

        instance_connection_name = os.environ[
            "POSTGRESQL_INSTANCE_CONNECTION_NAME"
        ]

        db_iam_user = os.environ["DB_IAM_USER"]
        db_name = os.environ["DB_NAME"]

        credentials = service_account.Credentials.from_service_account_file(
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"],
            scopes=[
                "https://www.googleapis.com/auth/sqlservice.admin"
            ],
        )

        _connector = Connector(
            credentials=credentials,
            refresh_strategy="LAZY",
        )

        def getconn() -> pg8000.dbapi.Connection:
            return _connector.connect(
                instance_connection_name,
                "pg8000",
                user=db_iam_user,
                db=db_name,
                ip_type=IPTypes.PUBLIC,
                enable_iam_auth=True,
            )

        _engine = sqlalchemy.create_engine(
            "postgresql+pg8000://",
            creator=getconn,

            # Check connections before giving them to the application.
            pool_pre_ping=True,

            # Prevent keeping old Cloud SQL connections forever.
            pool_recycle=1800,

            # Example pool settings.
            pool_size=5,
            max_overflow=10,
        )

        return _engine


def close_database() -> None:
    """
    Cleanly closes the SQLAlchemy pool and Cloud SQL Connector.
    """

    global _engine
    global _connector

    if _engine is not None:
        _engine.dispose()
        _engine = None