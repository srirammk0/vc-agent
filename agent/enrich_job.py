"""Enrichment job — Exa Connect (Fiber + Similarweb) with cheap Exa-search fallback.

Primary path: one Agent run (~$0.05 Connect + compute). Fallback: legacy 3× Exa
search + Haiku if Agent fails (no Apollo — emails come from Fiber only).
"""

import asyncio
import os

from supabase import create_client

from enrich import structure_enrichment, has_enrichment_content
from tools.exa import search_company, search_people, search_company_founders
from tools.exa_connect import run_enrich_connect

_SB_TIMEOUT = 30.0


def _sb_client():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


async def _sb_call(fn):
    return await asyncio.wait_for(asyncio.to_thread(fn), timeout=_SB_TIMEOUT)


def _normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not email or "@" not in email:
        return ""
    return email[:200]


def _map_connect_to_update(
    data: dict,
    existing_website: str,
) -> dict | None:
    founders_raw = data.get("founders") or []
    founder_profiles = []
    has_email = False

    for f in founders_raw[:5]:
        if not isinstance(f, dict):
            continue
        name = (f.get("name") or "").strip()
        if not name:
            continue
        email = _normalize_email(f.get("email") or "")
        if email:
            has_email = True
        positions = []
        for p in (f.get("positions") or [])[:8]:
            if not isinstance(p, dict):
                continue
            positions.append(
                {
                    "company": (p.get("company") or "")[:200],
                    "title": (p.get("title") or "")[:200],
                    "start_date": (p.get("start_date") or "")[:40],
                    "end_date": (p.get("end_date") or "")[:40],
                    "is_current": bool(p.get("is_current")),
                    "description": (p.get("description") or "")[:400],
                }
            )
        founder_profiles.append(
            {
                "name": name[:200],
                "background": (f.get("background") or "")[:500],
                "linkedin": (f.get("linkedin") or "")[:500],
                "email": email,
                "positions": positions,
                "credibility_note": (f.get("credibility_note") or "")[:800],
            }
        )

    desc = (data.get("company_description") or "").strip()
    if not desc and not any(f.get("positions") for f in founder_profiles):
        return None

    monthly_visits = data.get("monthly_visits")
    try:
        monthly_visits_int = int(monthly_visits) if monthly_visits is not None else None
    except (TypeError, ValueError):
        monthly_visits_int = None

    global_rank = data.get("global_rank")
    try:
        global_rank_int = int(global_rank) if global_rank is not None else None
    except (TypeError, ValueError):
        global_rank_int = None

    growth = data.get("visit_growth_pct")
    try:
        growth_f = float(growth) if growth is not None else None
    except (TypeError, ValueError):
        growth_f = None

    competitors = []
    for c in (data.get("competitors") or [])[:5]:
        if not isinstance(c, dict):
            continue
        competitors.append(
            {
                "name": (c.get("name") or "")[:200],
                "domain": (c.get("domain") or "")[:200],
                "monthly_visits": c.get("monthly_visits"),
            }
        )

    web_analytics: dict = {"source": "similarweb"}
    if monthly_visits_int is not None:
        web_analytics["monthly_visits"] = monthly_visits_int
    if global_rank_int is not None:
        web_analytics["global_rank"] = global_rank_int
    if growth_f is not None:
        web_analytics["visit_growth_pct"] = growth_f

    fiber_meta: dict = {}
    emp = data.get("fiber_employee_count")
    if emp is not None:
        try:
            fiber_meta["employee_count"] = int(emp)
        except (TypeError, ValueError):
            pass
    linkedin_co = (data.get("company_linkedin") or "").strip()
    if linkedin_co:
        fiber_meta["company_linkedin"] = linkedin_co[:500]

    website = (data.get("website") or "").strip()
    has_website = bool(existing_website.strip())

    update: dict = {
        "company_description": desc[:1500],
        "founded": (data.get("founded") or "")[:100] or None,
        "location": (data.get("location") or "")[:200] or None,
        "team_size": (data.get("team_size") or "")[:100] or None,
        "stage": (data.get("stage") or "")[:200] or None,
        "raised": (data.get("raised") or "")[:200] or None,
        "founders": founder_profiles,
        "enrichment_status": "complete",
        "enriched": bool(desc or any(f.get("positions") for f in founder_profiles)),
        "monthly_visits": monthly_visits_int,
        "global_rank": global_rank_int,
        "web_analytics": web_analytics,
        "competitors": competitors,
        "fiber_meta": fiber_meta,
        "has_email": has_email,
    }

    if not has_website and website:
        update["website"] = website[:500]

    return update


async def run_enrichment(slug: str, name: str) -> dict:
    sb = _sb_client()

    try:
        existing = await _sb_call(
            lambda: sb.table("startups").select("website").eq("slug", slug).single().execute()
        )
        website = ((existing.data or {}).get("website") or "").strip()

        connect_data = await run_enrich_connect(name, website)
        if connect_data:
            update = _map_connect_to_update(connect_data, website)
            if update:
                await _sb_call(lambda: sb.table("startups").update(update).eq("slug", slug).execute())
                return {"status": "enriched", "slug": slug, "source": "connect"}

        # Cheap fallback — no Connect credits, no Apollo
        company, people, founder_history = await asyncio.gather(
            search_company(f"{name} startup company"),
            search_people(f"founder CEO {name}"),
            search_company_founders(name),
        )

        structured = await structure_enrichment(name, company, people + founder_history)

        if not structured or not has_enrichment_content(structured):
            await _sb_call(
                lambda: sb.table("startups")
                .update({"enrichment_status": "pending"})
                .eq("slug", slug)
                .execute()
            )
            return {"status": "no_data", "slug": slug}

        founders = [
            {
                "name": f.name,
                "background": f.background[:500],
                "linkedin": f.linkedin or "",
                "email": "",
                "positions": [
                    {
                        "company": p.company,
                        "title": p.title,
                        "start_date": p.start_date,
                        "end_date": p.end_date,
                        "is_current": p.is_current,
                        "description": p.description[:400],
                    }
                    for p in f.positions[:8]
                ],
                "credibility_note": f.credibility_note[:800],
            }
            for f in structured.founders[:5]
        ]

        update = {
            "company_description": structured.company_description[:1500],
            "founded": structured.founded,
            "location": structured.location,
            "team_size": structured.team_size,
            "stage": structured.stage,
            "raised": structured.raised,
            "founders": founders,
            "enrichment_status": "complete",
            "enriched": True,
            "has_email": False,
        }
        if not website and structured.website:
            update["website"] = structured.website.strip()

        await _sb_call(lambda: sb.table("startups").update(update).eq("slug", slug).execute())
        return {"status": "enriched", "slug": slug, "source": "fallback"}

    except Exception as e:
        print(f"run_enrichment failed for {slug}: {type(e).__name__}: {e}")
        await _sb_call(
            lambda: sb.table("startups")
            .update({"enrichment_status": "failed"})
            .eq("slug", slug)
            .execute()
        )
        return {"status": "error", "slug": slug, "error": str(e)}
