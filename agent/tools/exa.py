import asyncio
import os
from exa_py import Exa

exa = Exa(api_key=os.environ["EXA_API_KEY"])


def _fmt(results) -> list[dict]:
    return [
        {
            "url": r.url,
            "title": r.title,
            "published": r.published_date,
            "score": r.score,
        }
        for r in results.results
    ]


def _dedupe(rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for row in rows:
        if row["url"] and row["url"] not in seen:
            seen.add(row["url"])
            out.append(row)
    return out


async def search(queries: list[str], category: str = "company") -> list[dict]:
    """
    Broad discovery search. Runs ALL queries in parallel and returns a single
    deduped list of URLs + metadata (no content fetched). Pass several distinct
    angles at once (e.g. new raises, stealth launches, accelerator batches,
    vertical AI, dev tools). category="company" or "news". Cheap, URLs only.
    """
    tasks = [
        asyncio.to_thread(exa.search, q, num_results=10, category=category)
        for q in queries
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    rows: list[dict] = []
    for res in results:
        if not isinstance(res, Exception):
            rows.extend(_fmt(res))
    return _dedupe(rows)


async def linkedin_search(queries: list[str]) -> list[dict]:
    """
    LinkedIn signal search (pre-seed raises, launches, accelerator news). Runs
    ALL queries in parallel and returns a single deduped list of URLs + metadata.
    """
    tasks = [
        asyncio.to_thread(
            exa.search, q, num_results=15, include_domains=["linkedin.com"]
        )
        for q in queries
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    rows: list[dict] = []
    for res in results:
        if not isinstance(res, Exception):
            rows.extend(_fmt(res))
    return _dedupe(rows)


async def get_contents(urls: list[str]) -> list[dict]:
    """
    Fetch full content for promising URLs in a single batched request. Only call
    this for the best NEW candidates (cap ~8) — it costs more credits per URL.
    Returns text + highlights for each URL.
    """
    urls = urls[:8]
    results = await asyncio.to_thread(
        exa.get_contents,
        urls,
        text={"max_characters": 3000},
        highlights={"num_sentences": 5, "highlights_per_url": 3},
    )
    return [
        {
            "url": r.url,
            "title": r.title,
            "content": r.text[:3000] if r.text else "",
            "highlights": r.highlights if r.highlights else [],
        }
        for r in results.results
    ]
