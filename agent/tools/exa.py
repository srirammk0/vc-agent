import asyncio
import os
from exa_py import Exa

exa = Exa(api_key=os.environ.get("EXA_API_KEY", ""))

# Enrichment data (company/founder info) changes slowly: serve Exa's cached
# crawl when possible and reuse our own result cache for a week.
_ENRICH_MAX_AGE_HOURS = 168
_ENRICH_TTL_SECONDS = 7 * 24 * 3600


def _import_cache():
    """Import the cache module whether running from /root/agent or repo root."""
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


async def _search(
    query: str,
    category: str,
    *,
    num_results: int = 3,
    max_characters: int = 1000,
    include_domains: list[str] | None = None,
    cache_prefix: str | None = None,
) -> list[dict]:
    cache = _import_cache()
    cache_key = None
    if cache is not None:
        cache_key = cache.make_key(f"exa:{cache_prefix or category}", query)
        cached = await cache.cache_get(cache_key, _ENRICH_TTL_SECONDS)
        if cached is not None:
            return cached

    kwargs: dict = {
        "category": category,
        "num_results": num_results,
        "contents": {
            "text": {"max_characters": max_characters},
            "max_age_hours": _ENRICH_MAX_AGE_HOURS,
        },
    }
    if include_domains:
        kwargs["include_domains"] = include_domains

    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(exa.search, query, **kwargs),
            timeout=30.0,
        )
        results = [
            {
                "url": r.url,
                "title": r.title,
                "text": r.text[:max_characters] if r.text else "",
            }
            for r in getattr(res, "results", [])
        ]
    except Exception as e:
        print(f"Exa {category} search failed: {e}")
        return []

    if cache is not None and cache_key and results:
        await cache.cache_set(cache_key, results)
    return results


async def search_company(query: str) -> list[dict]:
    """Search Exa for company profiles using the 'company' category."""
    return await _search(query, "company")


async def search_people(query: str) -> list[dict]:
    """Search Exa for people profiles using the 'people' category."""
    return await _search(query, "people")


async def search_company_founders(company_name: str) -> list[dict]:
    """LinkedIn-targeted founder search keyed by company rather than a known person's
    name — for the general enrichment path, where founder identities aren't known
    ahead of time (unlike a stealth sweep, which may already have a name from what
    it just read). Same richer budget as search_founder_history."""
    query = f"{company_name} founder co-founder linkedin"
    return await _search(
        query,
        "people",
        num_results=5,
        max_characters=3000,
        include_domains=["linkedin.com"],
        cache_prefix="founder_history",
    )


async def search_founder_history(name: str, context: str = "") -> list[dict]:
    """Search specifically for a founder's career history — LinkedIn-targeted (via
    include_domains) with a much larger text budget than search_people, since the
    goal here is a real work-history timeline (companies/titles/dates), not a
    one-line bio snippet. context: company name / role / domain, to disambiguate a
    common name and steer results toward the right person."""
    query = f"{name} {context} linkedin".strip()
    return await _search(
        query,
        "people",
        num_results=5,
        max_characters=3000,
        include_domains=["linkedin.com"],
        cache_prefix="founder_history",
    )
