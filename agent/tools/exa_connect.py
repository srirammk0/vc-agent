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


def _lookup_schema(focus: str) -> dict[str, Any]:
    if focus == "fiber":
        props = {k: ENRICH_OUTPUT_SCHEMA["properties"][k] for k in (
            "company_description", "website", "founded", "location", "team_size",
            "stage", "raised", "fiber_employee_count", "company_linkedin", "founders",
        )}
        return {"type": "object", "properties": props}
    if focus == "similarweb":
        props = {k: ENRICH_OUTPUT_SCHEMA["properties"][k] for k in (
            "monthly_visits", "global_rank", "visit_growth_pct", "competitors",
        )}
        return {"type": "object", "properties": props}
    return ENRICH_OUTPUT_SCHEMA


def build_partial_enrich_schema(gaps: Any) -> dict[str, Any] | None:
    """Build output_schema containing only fields we still need (see enrich_gaps.EnrichGaps)."""
    props: dict[str, Any] = {}
    if gaps.company_description:
        props["company_description"] = ENRICH_OUTPUT_SCHEMA["properties"]["company_description"]
    if gaps.company_meta:
        for field in ("founded", "location", "team_size", "stage", "raised"):
            props[field] = ENRICH_OUTPUT_SCHEMA["properties"][field]
    if gaps.website:
        props["website"] = ENRICH_OUTPUT_SCHEMA["properties"]["website"]
    if gaps.founders_timeline or gaps.founder_emails:
        props["founders"] = ENRICH_OUTPUT_SCHEMA["properties"]["founders"]
    if gaps.fiber_employee_count:
        props["fiber_employee_count"] = ENRICH_OUTPUT_SCHEMA["properties"]["fiber_employee_count"]
    if gaps.company_linkedin:
        props["company_linkedin"] = ENRICH_OUTPUT_SCHEMA["properties"]["company_linkedin"]
    if gaps.monthly_visits:
        props["monthly_visits"] = ENRICH_OUTPUT_SCHEMA["properties"]["monthly_visits"]
    if gaps.global_rank:
        props["global_rank"] = ENRICH_OUTPUT_SCHEMA["properties"]["global_rank"]
    if gaps.visit_growth:
        props["visit_growth_pct"] = ENRICH_OUTPUT_SCHEMA["properties"]["visit_growth_pct"]
    if gaps.competitors:
        props["competitors"] = ENRICH_OUTPUT_SCHEMA["properties"]["competitors"]
    if not props:
        return None
    required = ["company_description"] if "company_description" in props else list(props.keys())[:1]
    return {"type": "object", "required": required, "properties": props}


def _build_partial_query(name: str, website: str, gaps: Any, known_context: str) -> str:
    site = (website or "").strip()
    need_lines: list[str] = []
    if gaps.needs_fiber():
        fiber_bits = []
        if gaps.company_description:
            fiber_bits.append("company overview")
        if gaps.company_meta:
            fiber_bits.append("stage/raised/team/location/founded")
        if gaps.founders_timeline:
            fiber_bits.append("founder career timelines")
        if gaps.founder_emails:
            fiber_bits.append("founder work emails only (timelines already known)")
        if gaps.fiber_employee_count or gaps.company_linkedin:
            fiber_bits.append("employee count and company LinkedIn")
        if gaps.website:
            fiber_bits.append("official domain")
        need_lines.append(f"Fiber.ai: {', '.join(fiber_bits)}.")
    if gaps.needs_similarweb():
        sw_bits = []
        if gaps.monthly_visits:
            sw_bits.append("monthly visits")
        if gaps.global_rank:
            sw_bits.append("global rank")
        if gaps.visit_growth:
            sw_bits.append("traffic growth %")
        if gaps.competitors:
            sw_bits.append("up to 5 competitors")
        need_lines.append(f"Similarweb: {', '.join(sw_bits)}.")

    query = (
        f"VC diligence partial enrichment for startup '{name}'. "
        f"ONLY fill the fields listed below — do not return data we already have. "
        f"Only include facts supported by provider data.\n"
        f"Still needed:\n" + "\n".join(need_lines)
    )
    if site:
        query += f"\nKnown website/domain: {site}."
    if known_context:
        query += f"\n\nAlready on file (do NOT re-fetch or repeat):\n{known_context[:2500]}"
    return query


async def run_enrich_connect(
    name: str,
    website: str = "",
    slug: str = "",
    gaps: Any = None,
    known_context: str = "",
) -> dict[str, Any] | None:
    """One Agent run with only the Connect providers and schema fields still needed."""
    if gaps is not None and not gaps.needs_any():
        return None

    site = (website or "").strip()
    if gaps is not None:
        schema = build_partial_enrich_schema(gaps)
        if schema is None:
            return None
        data_sources: list[dict[str, str]] = []
        if gaps.needs_fiber():
            data_sources.append({"provider": "fiber"})
        if gaps.needs_similarweb():
            data_sources.append({"provider": "similarweb"})
        query = _build_partial_query(name, site, gaps, known_context)
        sig = gaps.signature()
    else:
        schema = ENRICH_OUTPUT_SCHEMA
        data_sources = list(_DATA_SOURCES_ENRICH)
        query = (
            f"VC diligence enrichment for startup '{name}'. "
            f"Use Fiber.ai for company profile, founders, work emails, employee count, funding. "
            f"Use Similarweb for estimated monthly visits, global rank, traffic growth, and up to 5 competitors. "
            f"Only include facts you can support from provider data — do not invent."
        )
        if site:
            query += f" Known website/domain: {site}."
        sig = "full"

    cache_key = f"exa:agent:enrich:{slug or name.lower()}:{site.lower()}:{sig}"
    return await _agent_run(cache_key, query, schema, data_sources, _ENRICH_TIMEOUT)


async def run_connect_lookup(
    company_name: str,
    website: str = "",
    focus: str = "full",
) -> dict[str, Any] | None:
    """Chat-tool lookup — one company, credit-conscious provider selection."""
    focus = (focus or "full").strip().lower()
    if focus not in ("fiber", "similarweb", "full"):
        focus = "full"

    name = (company_name or "").strip()
    if not name:
        return None

    site = (website or "").strip()
    if focus == "fiber":
        sources = list(_DATA_SOURCES_FIBER_ONLY)
        schema = _lookup_schema("fiber")
        query = (
            f"Structured B2B lookup for '{name}' via Fiber.ai: company profile, "
            f"funding, founders with career history and work emails if available."
        )
    elif focus == "similarweb":
        sources = [{"provider": "similarweb"}]
        schema = _lookup_schema("similarweb")
        query = (
            f"Web analytics for '{name}' via Similarweb: monthly visits, global rank, "
            f"growth, and up to 5 competitors."
        )
    else:
        sources = list(_DATA_SOURCES_ENRICH)
        schema = ENRICH_OUTPUT_SCHEMA
        query = (
            f"Full VC diligence lookup for '{name}': Fiber (company, founders, emails) "
            f"plus Similarweb (traffic and competitors)."
        )
    if site:
        query += f" Domain/website: {site}."

    cache_key = f"exa:agent:lookup:{focus}:{name.lower()}:{site.lower()}"
    return await _agent_run(cache_key, query, schema, sources, _ENRICH_TIMEOUT)


def format_connect_result(data: dict[str, Any] | None, max_chars: int = 8000) -> str:
    if not data:
        return "No structured results returned."
    import json

    text = json.dumps(data, indent=2, default=str)
    if len(text) > max_chars:
        return text[:max_chars] + "\n…[truncated]"
    return text


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
