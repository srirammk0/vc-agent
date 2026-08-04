from typing import Optional

from pydantic import BaseModel, Field
from pydantic_ai import Agent

import llm


class FounderPosition(BaseModel):
    """One entry in a founder's career timeline — the LinkedIn "experience" style
    history the dashboard renders as a timeline. Only ever built from what search
    results actually contain; leave a field empty rather than guessing."""
    company: str = Field(description="Company/organization name")
    title: str = Field(description="Role/title held there")
    start_date: str = Field(default="", description="e.g. '2019' or 'Jan 2019' — whatever precision the source gives")
    end_date: str = Field(default="", description="e.g. '2022' — empty if still current")
    is_current: bool = Field(default=False, description="True if this is their present role")
    description: str = Field(
        default="",
        description=(
            "1-2 sentences on what they actually did there — concrete proof points "
            "(shipped X, scaled Y, led a team of Z) over vague titles, when the source supports it."
        ),
    )


class FounderProfile(BaseModel):
    name: str
    background: str = Field(description="1-2 sentence professional background")
    linkedin: Optional[str] = None
    positions: list[FounderPosition] = Field(
        default_factory=list,
        description="Career history in reverse-chronological order (most recent first). Empty if nothing concrete was found — do not invent placeholder roles.",
    )
    credibility_note: str = Field(
        default="",
        description=(
            "ONE sentence — not a paragraph. A grounded read on whether this founder has real, "
            "relevant proof they can execute on what they're building now: name the specific prior "
            "company/role that actually supports it, don't just assert 'strong background.' If the "
            "search results don't support a real read, say so plainly in that one sentence instead of "
            "padding — 'couldn't verify much beyond X' is more useful than manufactured confidence."
        ),
    )


class EnrichmentResult(BaseModel):
    company_description: str = Field(
        description="2-3 concise sentences on what the company does and why it matters"
    )
    website: Optional[str] = Field(
        default=None,
        description=(
            "The company's own official homepage URL, if one of the search result "
            "URLs is clearly the company's primary site (not a news article, "
            "directory listing, or social profile). Omit if unsure."
        ),
    )
    founded: Optional[str] = None
    location: Optional[str] = None
    team_size: Optional[str] = None
    stage: Optional[str] = None
    raised: Optional[str] = None
    founders: list[FounderProfile] = Field(default_factory=list)


_enrich_agent = Agent(
    llm.fast_model,
    output_type=EnrichmentResult,
    system_prompt=(
        "You structure raw web search results into clean VC diligence notes. "
        "Be factual, concise, and only include fields you can support from the source text. "
        "Ignore unrelated companies with similar names. "
        "Founder names must be real people, not page titles or company names. "
        "If one of the source URLs is clearly the company's own official homepage "
        "(not a news article, funding database, directory, or social profile), "
        "extract it as the website.\n\n"
        "Founder quality is the priority, not an afterthought — for each founder, extract their "
        "career timeline (positions: company, title, dates, what they concretely did) from any "
        "LinkedIn or bio content in the search results, most recent first. Then write "
        "credibility_note as ONE sentence, not a paragraph: a specific, grounded read on whether "
        "they're a strong bet to execute on this problem, naming the actual prior company/role that "
        "supports it. This is the core signal a VC needs, especially when a company has nothing else "
        "public yet (no press, no site) — so extract everything the source material actually "
        "supports, but never invent a role, date, or achievement that isn't there. An empty "
        "positions list and a one-sentence honest 'couldn't verify much' credibility_note is the "
        "correct output when the search results are thin, not a reason to pad."
    ),
    model_settings=llm.ENRICH_SETTINGS,
)


_ENRICH_LLM_TTL_SECONDS = 7 * 24 * 3600


def _import_cache():
    try:
        import cache
        return cache
    except Exception:
        try:
            import sys
            sys.path.insert(0, "/root/agent")
            import cache
            return cache
        except Exception:
            return None


def _format_company_results(results: list[dict]) -> str:
    parts = []
    for r in results:
        parts.append(
            f"Title: {r.get('title', '')}\n"
            f"URL: {r.get('url', '')}\n"
            f"Content:\n{r.get('text', '')}"
        )
    return "\n---\n".join(parts)


def _format_people_results(results: list[dict]) -> str:
    parts = []
    for r in results:
        parts.append(
            f"Title: {r.get('title', '')}\n"
            f"URL: {r.get('url', '')}\n"
            f"Content:\n{r.get('text', '')}"
        )
    return "\n---\n".join(parts)


async def structure_enrichment(
    name: str,
    company_results: list[dict],
    people_results: list[dict],
) -> Optional[EnrichmentResult]:
    company_text = _format_company_results(company_results)
    people_text = _format_people_results(people_results)

    if not company_text.strip() and not people_text.strip():
        return None

    prompt = (
        f"Startup to enrich: {name}\n\n"
        f"COMPANY SEARCH RESULTS:\n{company_text[:6000]}\n\n"
        f"FOUNDER / PEOPLE SEARCH RESULTS:\n{people_text[:9000]}"
    )

    cache = _import_cache()
    cache_key = None
    if cache is not None:
        cache_key = cache.make_key("enrich:llm", prompt)
        cached = await cache.cache_get(cache_key, _ENRICH_LLM_TTL_SECONDS)
        if cached is not None:
            try:
                return EnrichmentResult.model_validate(cached)
            except Exception:
                pass

    result = await llm.run_with_retry(_enrich_agent, prompt, max_attempts=6, purpose="enrichment")
    output = result.output
    if cache is not None and cache_key:
        await cache.cache_set(cache_key, output.model_dump())
    return output


def has_enrichment_content(result: EnrichmentResult) -> bool:
    if result.company_description.strip():
        return True
    # A bare name/background/linkedin with no real researched career history isn't
    # enrichment — matches src/lib/enrichment.ts's hasEnrichmentData.
    return any(f.positions for f in result.founders)
