from pydantic import Field

from app.schemas.catalog import _Base


# ============================================================
# SETTINGS CHANGE
#
# Shared by every customer-level settings write that records who
# made the change (DOH today; see doh.py).
# ============================================================


class SettingsChangeBase(_Base):
    # TODO: take this from the signed-in user once the app has auth;
    # until then the client may say who made the change.
    updated_by: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
    )
