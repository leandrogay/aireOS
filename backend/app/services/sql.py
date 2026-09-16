from threading import Lock

import pg8000
import sqlalchemy
from google.cloud.sql.connector import Connector, IPTypes
from google.oauth2 import service_account
from sqlalchemy.engine import Engine

from app import config


_engine: Engine | None = None
_read_engine: Engine | None = None
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

        credentials = service_account.Credentials.from_service_account_file(
            config.require_file("GOOGLE_APPLICATION_CREDENTIALS"),
            scopes=[
                "https://www.googleapis.com/auth/sqlservice.admin"
            ],
        )

        _connector = Connector(
            credentials=credentials,
            refresh_strategy="LAZY",
        )

        _engine = _create_engine()

        return _engine


def connect_with_connector_autocommit() -> Engine:
    """
    Returns a shared SQLAlchemy Engine whose connections run in
    AUTOCOMMIT mode. Intended for single-SELECT read paths only.

    A plain connection costs an implicit BEGIN, a ROLLBACK on close
    and a pool reset on return. Against a remote Cloud SQL instance
    each of those is a full network round trip, so a read path pays
    ~4x the latency of the query itself. AUTOCOMMIT drops them.

    This has to be its own engine: setting the isolation level per
    connection via execution_options() makes SQLAlchemy reset it on
    every checkin, which costs more round trips than it saves.
    """

    global _read_engine

    if _read_engine is not None:
        return _read_engine

    # Reuse the connector (and its cached IAM token / certificate).
    connect_with_connector()

    with _lock:
        if _read_engine is not None:
            return _read_engine

        _read_engine = _create_engine(
            isolation_level="AUTOCOMMIT",
        )

        return _read_engine


def _create_engine(**engine_kwargs) -> Engine:
    """
    Builds an Engine on top of the shared Cloud SQL Connector.
    Must be called with _connector already initialised.
    """

    instance_connection_name = config.require(
        "POSTGRESQL_INSTANCE_CONNECTION_NAME"
    )

    db_iam_user = config.require("DB_IAM_USER")
    db_name = config.require("DB_NAME")

    def getconn() -> pg8000.dbapi.Connection:
        return _connector.connect(
            instance_connection_name,
            "pg8000",
            user=db_iam_user,
            db=db_name,
            ip_type=IPTypes.PUBLIC,
            enable_iam_auth=True,
        )

    return sqlalchemy.create_engine(
        "postgresql+pg8000://",
        creator=getconn,

        # Check connections before giving them to the application.
        pool_pre_ping=True,

        # Prevent keeping old Cloud SQL connections forever.
        pool_recycle=1800,

        # Example pool settings.
        pool_size=5,
        max_overflow=10,

        **engine_kwargs,
    )


def close_database() -> None:
    """
    Cleanly closes the SQLAlchemy pool and Cloud SQL Connector.
    """

    global _engine
    global _read_engine
    global _connector

    if _read_engine is not None:
        _read_engine.dispose()
        _read_engine = None

    if _engine is not None:
        _engine.dispose()
        _engine = None