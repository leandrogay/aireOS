"""Request models for upload lifecycle actions."""

from pydantic import Field

from app.schemas.catalog import _Base


class RollbackUploadRequest(_Base):
    """The immutable GCS object to roll back and the staff member's reason."""

    blob_path: str = Field(min_length=1, max_length=1024)
    reason: str = Field(min_length=3, max_length=500)
