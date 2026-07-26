"""Enrichment job — relocated here from modal_app.py's enrich_startup_job when
Modal was removed in favor of running everything through Trigger.dev's Python
extension (see agent/main.py, src/trigger/run-scheduled-check.ts). Writes directly
to Supabase, no agent/LLM-loop involvement beyond the narrow structuring call in
enrich.py — reached via run_agent()'s mode="enrich" dispatch instead of a
standalone Modal function, everything else about the job is unchanged.

The three Exa searches were sequential (asyncio.run() one at a time) in the Modal
version, since that function was synchronous top-to-bottom. Now that this runs
inside run_agent()'s existing event loop, they're awaited concurrently instead —
they're independent read-only lookups with no ordering dependency, so this is a
strict improvement picked up for free while relocating the code, not a behavior
change worth avoiding.
"""

import asyncio
import os

from supabase import create_client

from tools.exa import search_company, search_people, search_company_founders
from enrich import structure_enrichment, has_enrichment_content

_SB_TIMEOUT = 30.0


def _sb_client():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


async def _sb_call(fn):
    return await asyncio.wait_for(asyncio.to_thread(fn), timeout=_SB_TIMEOUT)


async def run_enrichment(slug: str, name: str) -> dict:
    """The dashboard's Enrich button already flips enrichment_status to "running"
    (src/app/api/enrich/route.ts, synchronously, before triggering this) — this
    function only does the actual research + write."""
    sb = _sb_client()

    try:
        existing = await _sb_call(
            lambda: sb.table("startups").select("website").eq("slug", slug).single().execute()
        )
        has_website = bool(((existing.data or {}).get("website") or "").strip())

        # Two founder searches: a generic one (surfaces who the founders even are)
        # plus a LinkedIn-targeted one with a much larger text budget (surfaces
        # actual career history, not just a one-line bio) — both feed the same
        # structuring call so the model has enough raw material for a real
        # timeline + credibility read, not just a name and a job title.
        company, people, founder_history = await asyncio.gather(
            search_company(f"{name} startup company"),
            search_people(f"founder CEO {name}"),
            search_company_founders(name),
        )

        structured = await structure_enrichment(name, company, people + founder_history)

        if not structured or not has_enrichment_content(structured):
            # Genuinely nothing found — distinct from the except block below
            # (a real crash), so the dashboard can tell "we tried and came up
            # empty" apart from "it broke." Both are retryable via Enrich again,
            # but only "failed" should read as an error to the user.
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
            # Denormalized flag the dashboard list reads instead of pulling this
            # whole founders blob for every row — see
            # scripts/migrate-egress-list-columns.sql.
            "enriched": True,
        }
        if not has_website and structured.website:
            update["website"] = structured.website.strip()

        await _sb_call(lambda: sb.table("startups").update(update).eq("slug", slug).execute())
    except Exception as e:
        # A real exception (Exa/LLM failure, bad response) — "failed", not
        # "pending", so the dashboard shows this as an actual error rather than
        # indistinguishable from "searched and found nothing."
        await _sb_call(
            lambda: sb.table("startups")
            .update({"enrichment_status": "failed"})
            .eq("slug", slug)
            .execute()
        )
        return {"status": "error", "slug": slug, "error": str(e)}

    return {"status": "enriched", "slug": slug}
