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


async def _search(query: str, category: str) -> list[dict]:
    cache = _import_cache()
    cache_key = None
    if cache is not None:
        cache_key = cache.make_key(f"exa:{category}", query)
        cached = await cache.cache_get(cache_key, _ENRICH_TTL_SECONDS)
        if cached is not None:
            return cached

    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(
                exa.search,
                query,
                category=category,
                num_results=3,
                contents={
                    "text": {"max_characters": 1000},
                    "max_age_hours": _ENRICH_MAX_AGE_HOURS,
                },
            ),
            timeout=30.0,
        )
        results = [
            {
                "url": r.url,
                "title": r.title,
                "text": r.text[:1000] if r.text else "",
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
