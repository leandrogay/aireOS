from pydantic import Field

from app.schemas.catalog import _Base

# One load request is one person's confirmation, so it stays a batch a person
# can read in the confirmation dialog, not the whole bucket.
MAX_FILES_PER_LOAD = 50


class LoadRequest(_Base):
    """Uploaded files to preview or load, by their blob path in the bucket."""

    blob_paths: list[str] = Field(min_length=1, max_length=MAX_FILES_PER_LOAD)
