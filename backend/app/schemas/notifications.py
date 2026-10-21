from pydantic import Field

from app.schemas.catalog import _Base


class MarkReadRequest(_Base):
    notification_ids: list[int] = Field(min_length=1)
