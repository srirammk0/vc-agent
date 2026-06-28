import os
from exa_py import Exa

exa = Exa(api_key=os.environ["EXA_API_KEY"])


async def exa_search(query: str, category: str = "company") -> list[dict]:
    """
    Broad discovery search. Returns URLs and metadata only — no content fetched.
    Use this first to find candidates cheaply. Pass category='company' for company
    search or category='news' for articles. Use for all initial discovery passes.
    """
    results = exa.search(
        query,
        num_results=10,
        category=category,
    )
    return [
        {
            "url": r.url,
            "title": r.title,
            "published": r.published_date,
            "score": r.score,
        }
        for r in results.results
    ]


async def exa_get_contents(urls: list[str]) -> list[dict]:
    """
    Fetch full content for a specific list of URLs. Only call this for promising
    candidates identified via exa_search — it costs more credits per call.
    Returns full text and highlights for each URL.
    """
    results = exa.get_contents(
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


async def social_search(query: str) -> list[dict]:
    """
    Search LinkedIn for funding announcements and launch signals.
    Returns URLs and metadata only (Exa indexes LinkedIn natively).
    Use for social signal discovery: pre-seed raises, launches, accelerator news.
    """
    results = exa.search(
        query,
        num_results=15,
        include_domains=["linkedin.com"],
    )
    return [
        {
            "url": r.url,
            "title": r.title,
            "published": r.published_date,
            "score": r.score,
        }
        for r in results.results
    ]
