"""Linkup web search + fetch — used for news, press checks, and light fact lookups."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

try:
    import cache
except ImportError:
    cache = None

LINKUP_BASE = "https://api.linkup.so/v1"
SEARCH_TTL_SECONDS = 6 * 3600
FETCH_TTL_SECONDS = 24 * 3600


def _api_key() -> str:
    return os.environ.get("LINKUP_API_KEY", "")


def week_ago_date() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")


def _cache_key(namespace: str, payload: dict) -> str | None:
    if cache is None:
        return None
    return cache.make_key(namespace, json.dumps(payload, sort_keys=True))


async def _cache_get(key: str | None, ttl: int) -> Any | None:
    if cache is None or key is None:
        return None
    return await cache.cache_get(key, ttl)


async def _cache_set(key: str | None, value: Any) -> None:
    if cache is None or key is None:
        return
    await cache.cache_set(key, value)


def _format_search_response(data: dict | str, output_type: str) -> str:
    if isinstance(data, str):
        return data

    parts: list[str] = []
    if output_type == "sourcedAnswer":
        answer = data.get("answer") or data.get("sourcedAnswer")
        if answer:
            parts.append(f"Answer: {answer}\n---")

    results = (
        data.get("results")
        or data.get("searchResults")
        or data.get("sources")
        or []
    )
    for item in results:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("title") or "Untitled"
        url = item.get("url") or ""
        content = item.get("content") or item.get("snippet") or ""
        parts.append(f"Title: {name}\nURL: {url}\nContent: {content}\n---")

    return "\n".join(parts) if parts else "No results found."


async def _post(path: str, body: dict) -> dict | str:
    key = _api_key()
    if not key:
        return "Linkup failed: LINKUP_API_KEY not set"

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{LINKUP_BASE}{path}",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:500] if e.response is not None else str(e)
        return f"Linkup HTTP {e.response.status_code}: {detail}"
    except Exception as e:
        return f"Linkup request failed: {e}"


async def search(
    q: str,
    *,
    depth: str = "standard",
    output_type: str = "searchResults",
    include_domains: Optional[list[str]] = None,
    from_date: Optional[str] = None,
    max_results: int = 5,
) -> str:
    body: dict[str, Any] = {
        "q": q,
        "depth": depth,
        "outputType": output_type,
        "maxResults": max_results,
    }
    if include_domains:
        body["includeDomains"] = include_domains[:50]
    if from_date:
        body["fromDate"] = from_date

    cache_key = _cache_key("linkup:search", body)
    cached = await _cache_get(cache_key, SEARCH_TTL_SECONDS)
    if cached is not None:
        return cached

    data = await _post("/search", body)
    output = _format_search_response(data, output_type)

    if cache_key and not output.startswith("Linkup"):
        await _cache_set(cache_key, output)
    return output


async def search_many(
    queries: list[dict],
    *,
    default_from_date: Optional[str] = None,
) -> str:
    if not queries:
        return "No queries provided."

    async def _one(spec: dict) -> tuple[str, str]:
        q = spec.get("q") or spec.get("query") or ""
        domains = spec.get("include_domains") or spec.get("includeDomains")
        depth = spec.get("depth") or "standard"
        from_date = spec.get("from_date") or spec.get("fromDate") or default_from_date
        result = await search(
            q,
            depth=depth,
            include_domains=domains,
            from_date=from_date,
        )
        return q, result

    pairs = await asyncio.gather(*[_one(q) for q in queries])
    return "\n\n".join(f"=== Query: {q} ===\n{result}" for q, result in pairs)


async def fetch(url: str, *, render_js: bool = True) -> str:
    body = {"url": url, "renderJs": render_js}
    cache_key = _cache_key("linkup:fetch", body)
    cached = await _cache_get(cache_key, FETCH_TTL_SECONDS)
    if cached is not None:
        return cached

    data = await _post("/fetch", body)
    if isinstance(data, str):
        return data

    markdown = data.get("markdown") or ""
    if not markdown.strip():
        return f"No content fetched from {url}"

    output = f"URL: {url}\n\n{markdown[:8000]}"
    if cache_key:
        await _cache_set(cache_key, output)
    return output
