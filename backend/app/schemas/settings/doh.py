from decimal import Decimal

from pydantic import Field, model_validator

from app.schemas.catalog import _Base
from app.schemas.settings.common import SettingsChangeBase


# ============================================================
# DOH SETTINGS
#
# Thresholds are stored as NUMERIC(6,2), so input is limited to what
# that column holds exactly (at most 2 decimal places, up to 9999.99).
# Anything finer would be rounded by the database and then no longer
# match the "unchanged" check, saving a duplicate version.
# The doh_settings CHECK (min <= target <= max) stays as the backstop.
# ============================================================


class DohThresholdsUpdate(SettingsChangeBase):
    min_doh: Decimal = Field(ge=0, max_digits=6, decimal_places=2)
    target_doh: Decimal = Field(ge=0, max_digits=6, decimal_places=2)
    max_doh: Decimal = Field(ge=0, max_digits=6, decimal_places=2)

    @model_validator(mode="after")
    def validate_order(self):
        if self.min_doh > self.target_doh:
            raise ValueError("min_doh cannot be greater than target_doh")

        if self.target_doh > self.max_doh:
            raise ValueError("target_doh cannot be greater than max_doh")

        return self


class DohRevert(SettingsChangeBase):
    pass


class DohAlertUpdate(_Base):
    doh_alert_enabled: bool
