from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class Founder(BaseModel):
    name: str
    background: str
    linkedin: Optional[str] = None
    x_twitter: Optional[str] = None


class ScoreBreakdown(BaseModel):
    founder_pedigree: int   # /25
    ai_native: int          # /20
    early_traction: int     # /20
    obscurity_bonus: int    # /15
    recency: int            # /10
    warm_intro_potential: int # /10
    
    # Bonuses / Penalties
    triangulation_bonus: int = 0
    recent_press_penalty: int = 0
    crunchbase_news_penalty: int = 0
    high_google_rank_penalty: int = 0
    large_round_signal_penalty: int = 0
    
    total: int              # /100


class EnrichmentData(BaseModel):
    founder_linkedin_scraped: bool = False
    founder_x_scraped: bool = False
    prior_company_outcome: Optional[str] = None
    domain_writing: Optional[str] = None
    warm_intro_paths: Optional[str] = None


class Startup(BaseModel):
    name: str
    slug: str               # kebab-case, used as filename
    one_liner: str
    website: Optional[str] = None
    founded: Optional[str] = None
    location: Optional[str] = None
    team_size: Optional[int] = None
    stage: Optional[str] = None
    raised: Optional[str] = None
    what_they_do: str
    founders: list[Founder]
    signal_urls: list[str] = []
    sources: list[str] = [] # "x", "linkedin", "hn", "ph"
    score: ScoreBreakdown
    status: str = "new"     # new | approved | passed
    enrichment_status: str = "pending" # pending | running | complete
    enrichment: Optional[EnrichmentData] = None
    found_date: str = datetime.now().strftime("%Y-%m-%d")
