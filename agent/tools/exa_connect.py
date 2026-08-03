"""Exa Agent + Connect (Fiber.ai, Similarweb) — one structured run per job.

Credit-conscious defaults:
  - effort="low" on every run
  - maxItems caps in output_schema (5 competitors, 5 founders, 10 sourcing hits)
  - 7-day result cache
  - Fiber + Similarweb only on enrichment (not double-sourced on sourcing)
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from exa_py import Exa

exa = Exa(api_key=os.environ.get("EXA_API_KEY", ""))

_AGENT_TTL_SECONDS = 7 * 24 * 3600
_ENRICH_TIMEOUT = 150.0
_SOURCING_TIMEOUT = 180.0

_DATA_SOURCES_ENRICH = [{"provider": "fiber"}, {"provider": "similarweb"}]
_DATA_SOURCES_FIBER_ONLY = [{"provider": "fiber"}]


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


ENRICH_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["company_description"],
    "properties": {
        "company_description": {
            "type": "string",
            "description": "2-3 factual sentences on what the company does.",
        },
        "website": {"type": "string", "description": "Official company domain or homepage URL."},
        "founded": {"type": "string"},
        "location": {"type": "string"},
        "team_size": {"type": "string"},
        "stage": {"type": "string"},
        "raised": {"type": "string"},
        "monthly_visits": {
            "type": "integer",
            "description": "Estimated monthly website visits from Similarweb.",
        },
        "global_rank": {
            "type": "integer",
            "description": "Global website rank from Similarweb, if available.",
        },
        "visit_growth_pct": {
            "type": "number",
            "description": "Approx recent traffic growth % from Similarweb, if available.",
        },
        "fiber_employee_count": {"type": "integer", "description": "from Fiber.ai"},
        "company_linkedin": {"type": "string", "description": "Company LinkedIn URL from Fiber."},
        "founders": {
            "type": "array",
            "maxItems": 5,
            "items": {
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": {"type": "string"},
                    "background": {"type": "string"},
                    "linkedin": {"type": "string"},
                    "email": {
                        "type": "string",
                        "format": "email",
                        "description": "Work email from Fiber if available. Omit if unknown.",
                    },
                    "credibility_note": {
                        "type": "string",
                        "description": "ONE sentence on relevant prior proof.",
                    },
                    "positions": {
                        "type": "array",
                        "maxItems": 8,
                        "items": {
                            "type": "object",
                            "properties": {
                                "company": {"type": "string"},
                                "title": {"type": "string"},
                                "start_date": {"type": "string"},
                                "end_date": {"type": "string"},
                                "is_current": {"type": "boolean"},
                                "description": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
        "competitors": {
            "type": "array",
            "maxItems": 5,
            "description": "Top competitors from Similarweb.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "domain": {"type": "string"},
                    "monthly_visits": {"type": "integer"},
                },
            },
        },
    },
}

FIBER_SOURCING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["companies"],
    "properties": {
        "companies": {
            "type": "array",
            "maxItems": 10,
            "items": {
                "type": "object",
                "required": ["name", "one_liner"],
                "properties": {
                    "name": {"type": "string"},
                    "domain": {"type": "string"},
                    "one_liner": {"type": "string"},
                    "stage": {"type": "string"},
                    "raised": {"type": "string"},
                    "team_size": {"type": "string"},
                    "monthly_visits": {"type": "integer"},
                    "assessment_notes": {
                        "type": "string",
                        "description": "2-3 sentence VC-style assessment with concrete facts.",
                    },
                },
            },
        },
    },
}


def _structured_output(run: Any) -> dict[str, Any] | None:
    output = getattr(run, "output", None)
    if output is None:
        return None
    structured = getattr(output, "structured", None)
    if isinstance(structured, dict):
        return structured
    if hasattr(structured, "model_dump"):
        return structured.model_dump()
    content = getattr(output, "content", None)
    if isinstance(content, dict):
        return content
    return None


async def _agent_run(
    cache_key: str,
    query: str,
    output_schema: dict[str, Any],
    data_sources: list[dict[str, str]],
    timeout: float,
) -> dict[str, Any] | None:
    cache = _import_cache()
    if cache is not None:
        cached = await cache.cache_get(cache_key, _AGENT_TTL_SECONDS)
        if isinstance(cached, dict):
            return cached

    try:
        run = await asyncio.wait_for(
            asyncio.to_thread(
                exa.agent.runs.create,
                query=query,
                output_schema=output_schema,
                data_sources=data_sources,
                effort="low",
            ),
            timeout=30.0,
        )
        run = await asyncio.wait_for(
            asyncio.to_thread(exa.agent.runs.poll_until_finished, run.id),
            timeout=timeout,
        )
    except Exception as e:
        print(f"Exa Agent run failed: {e}")
        return None

    if getattr(run, "status", None) != "completed":
        print(f"Exa Agent run incomplete: status={getattr(run, 'status', None)}")
        return None

    data = _structured_output(run)
    if data and cache is not None:
        await cache.cache_set(cache_key, data)

    usage = getattr(run, "usage", None)
    costs = getattr(run, "cost_dollars", None)
    if usage or costs:
        print(
            f"Exa Agent run {run.id}: usage={usage}, cost_dollars={costs}"
        )

    return data


async def run_enrich_connect(name: str, website: str = "") -> dict[str, Any] | None:
    """One Agent run: Fiber (company/people/email) + Similarweb (traffic + competitors)."""
    site = (website or "").strip()
    query = (
        f"VC diligence enrichment for startup '{name}'. "
        f"Use Fiber.ai for company profile, founders, work emails, employee count, funding. "
        f"Use Similarweb for estimated monthly visits, global rank, traffic growth, and up to 5 competitors. "
        f"Only include facts you can support from provider data — do not invent."
    )
    if site:
        query += f" Known website/domain: {site}."

    cache_key = f"exa:agent:enrich:{name.lower()}:{site.lower()}"
    return await _agent_run(
        cache_key,
        query,
        ENRICH_OUTPUT_SCHEMA,
        _DATA_SOURCES_ENRICH,
        _ENRICH_TIMEOUT,
    )


async def run_fiber_sourcing(thesis_snippet: str) -> list[dict[str, Any]]:
    """One Agent run: Fiber-only list build (max 10). No Similarweb — saves a Connect call."""
    thesis = (thesis_snippet or "").strip()[:800]
    query = (
        "Build a short list of NEW pre-seed or seed-stage AI/software startups that match this VC thesis. "
        "Use Fiber.ai only. Prefer companies with little press coverage. "
        f"Thesis: {thesis or 'pre-seed AI startups, US-focused, strong technical teams.'}"
    )

    cache_key = f"exa:agent:fiber_sourcing:{hash(thesis) & 0xffffffff:08x}"
    data = await _agent_run(
        cache_key,
        query,
        FIBER_SOURCING_SCHEMA,
        _DATA_SOURCES_FIBER_ONLY,
        _SOURCING_TIMEOUT,
    )
    if not data:
        return []
    companies = data.get("companies") or []
    return [c for c in companies if isinstance(c, dict) and (c.get("name") or "").strip()]
