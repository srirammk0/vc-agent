import os
import asyncio
from typing import Optional

from openai import AsyncOpenAI, RateLimitError
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider


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


_cerebras = AsyncOpenAI(
    base_url="https://api.cerebras.ai/v1",
    api_key=os.environ.get("CEREBRAS_API_KEY", ""),
    max_retries=0,
)

_model = OpenAIChatModel(
    "gpt-oss-120b",
    provider=OpenAIProvider(openai_client=_cerebras),
)

_enrich_agent = Agent(
    _model,
    output_type=EnrichmentResult,
    system_prompt=(
        "You structure raw web search results into clean VC diligence notes. "
        "Be factual, concise, and only include fields you can support from the source text. "
        "Ignore unrelated companies with similar names. "
        "Founder names must be real people, not page titles or company names."
    ),
)


def _is_rate_limit_error(exc: BaseException) -> bool:
    if isinstance(exc, RateLimitError):
        return True
    if isinstance(exc, ModelHTTPError) and exc.status_code == 429:
        return True
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return _is_rate_limit_error(cause)
    return False


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

    max_attempts = 4
    for attempt in range(max_attempts):
        try:
            result = await _enrich_agent.run(prompt)
            return result.output
        except Exception as e:
            if not _is_rate_limit_error(e) or attempt == max_attempts - 1:
                raise
            await asyncio.sleep(3 * (2 ** attempt))

    return None


def has_enrichment_content(result: EnrichmentResult) -> bool:
    if result.company_description.strip():
        return True
    return any(
        f.name.strip() or f.background.strip() or (f.linkedin or "").strip()
        for f in result.founders
    )
