from pydantic import Field

from app.schemas.catalog import _Base


class BudgetLock(_Base):
    year: int = Field(ge=2000, le=2100)
