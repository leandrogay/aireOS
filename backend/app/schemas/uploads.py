"""Request models for upload lifecycle actions."""
from pydantic import Field

from app.schemas.catalog import _Base


class RollbackUploadRequest(_Base):
    """The immutable GCS object to roll back and the staff member's reason."""

    blob_path: str = Field(min_length=1, max_length=1024)
    reason: str = Field(min_length=3, max_length=500)


class DeleteUploadRequest(_Base):
    """The exact raw upload object to remove from GCS."""

    blob_path: str = Field(min_length=1, max_length=1024)


# One load request is one person's confirmation, so it stays a batch a person
# can read in the confirmation dialog, not the whole bucket.
MAX_FILES_PER_LOAD = 50


class LoadRequest(_Base):
    """Uploaded files to preview or load, by their blob path in the bucket."""

    blob_paths: list[str] = Field(min_length=1, max_length=MAX_FILES_PER_LOAD)
