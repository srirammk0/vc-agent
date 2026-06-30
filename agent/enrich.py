from typing import Optional

from pydantic import BaseModel, Field
from pydantic_ai import Agent

import llm


class FounderProfile(BaseModel):
    name: str
    background: str = Field(description="1-2 sentence professional background")
    linkedin: Optional[str] = None


class EnrichmentResult(BaseModel):
    company_description: str = Field(
        description="2-3 concise sentences on what the company does and why it matters"
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
        "Founder names must be real people, not page titles or company names."
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
        f"FOUNDER / PEOPLE SEARCH RESULTS:\n{people_text[:4000]}"
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

    result = await llm.run_with_retry(_enrich_agent, prompt, max_attempts=4)
    output = result.output
    if cache is not None and cache_key:
        await cache.cache_set(cache_key, output.model_dump())
    return output


def has_enrichment_content(result: EnrichmentResult) -> bool:
    if result.company_description.strip():
        return True
    return any(
        f.name.strip() or f.background.strip() or (f.linkedin or "").strip()
        for f in result.founders
    )
