import os
from pathlib import Path
from dotenv import load_dotenv
from google.oauth2 import service_account
from google.cloud.sql.connector import Connector, IPTypes
import pg8000
import sqlalchemy

ENV_PATH = Path(__file__).resolve().parents[2]
load_dotenv(ENV_PATH)

def connect_with_connector() -> sqlalchemy.engine.base.Engine:
    instance_connection_name = os.environ["POSTGRESQL_INSTANCE_CONNECTION_NAME"]
    
    db_iam_user = os.environ["DB_IAM_USER"]
    db_name = os.environ["DB_NAME"]

    ip_type = IPTypes.PUBLIC

    credentials = service_account.Credentials.from_service_account_file(
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"],
        scopes=["https://www.googleapis.com/auth/sqlservice.admin"],
    )

    connector = Connector(credentials=credentials, refresh_strategy="LAZY")

    def getconn() -> pg8000.dbapi.Connection:
        return connector.connect(
            instance_connection_name,
            "pg8000",
            user=db_iam_user,
            db=db_name,
            ip_type=ip_type,
            enable_iam_auth=True,
        )

    pool = sqlalchemy.create_engine("postgresql+pg8000://", creator=getconn)
    return pool