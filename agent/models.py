from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Founder(BaseModel):
    name: str
    background: str
    linkedin: Optional[str] = None


class ScoreBreakdown(BaseModel):
    founder_pedigree: int   # /25
    ai_native: int          # /20
    stage_fit: int          # /20
    recency: int            # /15
    traction: int           # /10
    geo_fit: int            # /10
    total: int              # /100


class Startup(BaseModel):
    name: str
    slug: str               # kebab-case, used as filename
    website: Optional[str] = None
    founded: Optional[str] = None
    location: Optional[str] = None
    team_size: Optional[int] = None
    stage: Optional[str] = None
    raised: Optional[str] = None
    what_they_do: str
    founders: list[Founder]
    signal_url: str
    signal_source: str
    score: ScoreBreakdown
    status: str = "new"     # new | reviewing | interested | passed | pitched
    found_date: str = datetime.now().strftime("%Y-%m-%d")


class AlertDetail(BaseModel):
    name: str
    slug: str
    score: int
    one_liner: str          # one sentence, plain english
    website: str
    founder_linkedin: str   # primary founder's LinkedIn URL


class RunSummary(BaseModel):
    trigger: str
    timestamp: str
    duration_seconds: float
    queries_run: int
    pages_enriched: int
    startups_found: int
    startups_updated: int
    alerts_sent: int
    skipped_known: int
    new_startups: list[str]         # slugs
    high_signal: list[str]          # slugs with score >= 75
    high_signal_details: list[AlertDetail] = []  # full data for SendBlue alerts
