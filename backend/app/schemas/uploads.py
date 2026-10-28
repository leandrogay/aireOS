"""Request models for upload lifecycle actions."""

from pydantic import Field

from app.schemas.catalog import _Base


class RollbackUploadRequest(_Base):
    """The immutable GCS object to roll back and the optional audit reason."""

    blob_path: str = Field(min_length=1, max_length=1024)
    reason: str | None = Field(default=None, max_length=500)
