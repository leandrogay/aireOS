from pydantic import Field

from app.schemas.catalog import _Base


class BudgetLock(_Base):
    year: int = Field(ge=2000, le=2100)
    # Optional, to tell versions apart ("Base case", "Aggressive promotions").
    name: str | None = Field(default=None, min_length=1, max_length=80)
    # The year's first version is official whatever this says.
    make_official: bool = True


class BudgetStart(_Base):
    year: int = Field(ge=2000, le=2100)
    # The locked version whose entries are copied in; None = from scratch.
    version: int | None = Field(default=None, ge=1)


class BudgetOfficial(_Base):
    year: int = Field(ge=2000, le=2100)
    version: int = Field(ge=1)
