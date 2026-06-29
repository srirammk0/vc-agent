from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class Startup(BaseModel):
    slug: str
    name: str
    website: Optional[str] = None
    one_liner: str
    assessment: str
    signal_urls: list[str] = []
    status: str = "new"  # new | approved | passed
    found_date: str = Field(
        default_factory=lambda: datetime.now().strftime("%Y-%m-%d")
    )
