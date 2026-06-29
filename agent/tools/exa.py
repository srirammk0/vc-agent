import asyncio
import os
from exa_py import Exa

exa = Exa(api_key=os.environ.get("EXA_API_KEY", ""))


def _fmt(results, source: str) -> list[dict]:
    return [
        {
            "url": r.url,
            "title": r.title,
            "published": r.published_date,
            "score": r.score,
            "source": source
        }
        for r in getattr(results, "results", [])
    ]


def _dedupe(rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for row in rows:
        if row["url"] and row["url"] not in seen:
            seen.add(row["url"])
            out.append(row)
    return out


async def search_x(queries: list[str]) -> list[dict]:
    """Search X (Twitter) for startup signals (beta, waitlist)."""
    tasks = [
        asyncio.to_thread(exa.search, q, num_results=10, include_domains=["x.com", "twitter.com"])
        for q in queries
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    rows: list[dict] = []
    for res in results:
        if not isinstance(res, Exception):
            rows.extend(_fmt(res, "x"))
    return _dedupe(rows)


async def search_linkedin(queries: list[str]) -> list[dict]:
    """Search LinkedIn for building-in-public and launches."""
    tasks = [
        asyncio.to_thread(exa.search, q, num_results=10, include_domains=["linkedin.com"])
        for q in queries
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    rows: list[dict] = []
    for res in results:
        if not isinstance(res, Exception):
            rows.extend(_fmt(res, "linkedin"))
    return _dedupe(rows)


async def search_hn(queries: list[str]) -> list[dict]:
    """Search Hacker News for Show HN launches."""
    tasks = [
        asyncio.to_thread(exa.search, q, num_results=10, include_domains=["news.ycombinator.com"])
        for q in queries
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    rows: list[dict] = []
    for res in results:
        if not isinstance(res, Exception):
            rows.extend(_fmt(res, "hn"))
    return _dedupe(rows)


async def search_ph(queries: list[str]) -> list[dict]:
    """Search ProductHunt for quiet launches."""
    tasks = [
        asyncio.to_thread(exa.search, q, num_results=10, include_domains=["producthunt.com"])
        for q in queries
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    rows: list[dict] = []
    for res in results:
        if not isinstance(res, Exception):
            rows.extend(_fmt(res, "ph"))
    return _dedupe(rows)


async def get_contents(urls: list[str]) -> list[dict]:
    """
    Fetch full content for promising URLs in a single batched request. 
    Only call this for the best NEW candidates — it costs more credits per URL.
    Returns text for each URL.
    """
    if not urls:
        return []
        
    results = await asyncio.to_thread(
        exa.get_contents,
        urls,
        text={"max_characters": 3000}
    )
    return [
        {
            "url": r.url,
            "title": r.title,
            "content": r.text[:3000] if r.text else "",
        }
        for r in getattr(results, "results", [])
    ]


async def search_company(query: str) -> list[dict]:
    """Search Exa for company profiles using the 'company' category."""
    try:
        res = await asyncio.to_thread(
            exa.search,
            query,
            category="company",
            num_results=3,
            text=True
        )
        return [
            {
                "url": r.url,
                "title": r.title,
                "text": r.text[:1000] if r.text else ""
            }
            for r in getattr(res, "results", [])
        ]
    except Exception as e:
        print(f"Exa company search failed: {e}")
        return []


async def search_people(query: str) -> list[dict]:
    """Search Exa for people profiles using the 'people' category."""
    try:
        res = await asyncio.to_thread(
            exa.search,
            query,
            category="people",
            num_results=3,
            text=True
        )
        return [
            {
                "url": r.url,
                "title": r.title,
                "text": r.text[:1000] if r.text else ""
            }
            for r in getattr(res, "results", [])
        ]
    except Exception as e:
        print(f"Exa people search failed: {e}")
        return []

