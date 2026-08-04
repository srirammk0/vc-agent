"""Enrichment job — partial Exa Connect (only missing fields) + cheap Exa fallback."""

import asyncio
import os
import time
from datetime import datetime, timedelta, timezone

import httpx
from supabase import create_client

import observability

from enrich import structure_enrichment, has_enrichment_content
from enrich_gaps import assess_enrich_gaps, known_context_summary
from tools.exa import search_company, search_people, search_company_founders
from tools.exa_connect import run_enrich_connect

_SB_TIMEOUT = 30.0

_ENRICH_SELECT = (
    "slug, name, website, company_description, founded, location, team_size, enrichment_error, "
    "stage, raised, founders, monthly_visits, global_rank, web_analytics, "
    "competitors, fiber_meta, has_email, enriched"
)


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


def _text(val) -> str:
    return (val or "").strip()


def _merge_founders(existing: list, new_raw: list, gaps) -> list:
    """Merge Connect founder payload into existing — keep good data, fill gaps only."""
    existing_list = [f for f in (existing or []) if isinstance(f, dict)]
    if not new_raw:
        return existing_list

    if gaps.founders_timeline and not existing_list:
        # Full replace from Connect
        return _normalize_founders_from_connect(new_raw)

    by_name = {_text(f.get("name")).lower(): dict(f) for f in existing_list if _text(f.get("name"))}

    for f in new_raw[:5]:
        if not isinstance(f, dict):
            continue
        name = _text(f.get("name"))
        if not name:
            continue
        key = name.lower()
        base = by_name.get(key, {"name": name[:200]})

        if gaps.founders_timeline:
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
            if positions:
                base["positions"] = positions
            if _text(f.get("background")):
                base["background"] = _text(f.get("background"))[:500]
            if _text(f.get("linkedin")):
                base["linkedin"] = _text(f.get("linkedin"))[:500]
            if _text(f.get("credibility_note")):
                base["credibility_note"] = _text(f.get("credibility_note"))[:800]

        if gaps.founder_emails or gaps.founders_timeline:
            email = _normalize_email(f.get("email") or "")
            if email and not _text(base.get("email")):
                base["email"] = email

        by_name[key] = base

    if by_name:
        return list(by_name.values())
    return _normalize_founders_from_connect(new_raw) if gaps.founders_timeline else existing_list


def _normalize_founders_from_connect(founders_raw: list) -> list:
    out = []
    for f in founders_raw[:5]:
        if not isinstance(f, dict):
            continue
        name = _text(f.get("name"))
        if not name:
            continue
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
        out.append(
            {
                "name": name[:200],
                "background": _text(f.get("background"))[:500],
                "linkedin": _text(f.get("linkedin"))[:500],
                "email": _normalize_email(f.get("email") or ""),
                "positions": positions,
                "credibility_note": _text(f.get("credibility_note"))[:800],
            }
        )
    return out


def _merge_connect_into_update(existing: dict, data: dict, gaps) -> dict | None:
    row = dict(existing)
    update: dict = {"enrichment_status": "complete"}

    if gaps.company_description and _text(data.get("company_description")):
        update["company_description"] = _text(data["company_description"])[:1500]

    if gaps.company_meta:
        for field in ("founded", "location", "team_size", "stage", "raised"):
            if _text(data.get(field)) and not _text(row.get(field)):
                update[field] = _text(data[field])[:200]

    if gaps.website and not _text(row.get("website")) and _text(data.get("website")):
        update["website"] = _text(data["website"])[:500]

    founders_raw = data.get("founders") or []
    if gaps.founders_timeline or gaps.founder_emails:
        merged = _merge_founders(row.get("founders") or [], founders_raw, gaps)
        if merged:
            update["founders"] = merged

    if gaps.monthly_visits and data.get("monthly_visits") is not None:
        try:
            update["monthly_visits"] = int(data["monthly_visits"])
        except (TypeError, ValueError):
            pass

    if gaps.global_rank and data.get("global_rank") is not None:
        try:
            update["global_rank"] = int(data["global_rank"])
        except (TypeError, ValueError):
            pass

    web_analytics = dict(row.get("web_analytics") or {}) if isinstance(row.get("web_analytics"), dict) else {}
    web_changed = False
    if gaps.monthly_visits and update.get("monthly_visits") is not None:
        web_analytics["monthly_visits"] = update["monthly_visits"]
        web_analytics["source"] = "similarweb"
        web_changed = True
    if gaps.global_rank and update.get("global_rank") is not None:
        web_analytics["global_rank"] = update["global_rank"]
        web_changed = True
    if gaps.visit_growth and data.get("visit_growth_pct") is not None:
        try:
            web_analytics["visit_growth_pct"] = float(data["visit_growth_pct"])
            web_analytics["source"] = "similarweb"
            web_changed = True
        except (TypeError, ValueError):
            pass
    if web_changed:
        update["web_analytics"] = web_analytics

    if gaps.competitors and data.get("competitors"):
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
        if competitors:
            update["competitors"] = competitors

    fiber_meta = dict(row.get("fiber_meta") or {}) if isinstance(row.get("fiber_meta"), dict) else {}
    fiber_changed = False
    if gaps.fiber_employee_count and data.get("fiber_employee_count") is not None:
        try:
            fiber_meta["employee_count"] = int(data["fiber_employee_count"])
            fiber_changed = True
        except (TypeError, ValueError):
            pass
    if gaps.company_linkedin and _text(data.get("company_linkedin")):
        fiber_meta["company_linkedin"] = _text(data["company_linkedin"])[:500]
        fiber_changed = True
    if fiber_changed:
        update["fiber_meta"] = fiber_meta

    founders_final = update.get("founders") or row.get("founders") or []
    has_email = any(_normalize_email((f or {}).get("email") or "") for f in founders_final if isinstance(f, dict))
    update["has_email"] = bool(has_email)

    desc = update.get("company_description") or _text(row.get("company_description"))
    has_timeline = any(
        isinstance(f, dict) and (f.get("positions") or []) for f in (founders_final if isinstance(founders_final, list) else [])
    )
    # A startup is fully enriched only when the researched enrichment exists
    # and at least one founder has a usable email address.
    update["enriched"] = bool((desc or has_timeline) and has_email)

    # Nothing new besides status flags
    if len(update) <= 2 and not update.get("company_description") and not update.get("founders"):
        if not any(k in update for k in ("monthly_visits", "global_rank", "web_analytics", "competitors", "fiber_meta", "website")):
            return None

    return update


# Re-trigger target — the same Trigger.dev task the dashboard route fires for a
# single enrich (src/trigger/run-scheduled-check.ts -> agent/main.py mode="enrich"),
# called via the same REST endpoint trigger_client.py already uses for scheduling.
_TRIGGER_TRIGGER_URL = "https://api.trigger.dev/api/v1/tasks/run-scheduled-check/trigger"

# Matches src/lib/enrichment.ts STALE_RUNNING_MS — a row still "running" past this
# is stuck (task killed before it reset the status), so it's safe to requeue.
_STALE_RUNNING_MS = 10 * 60 * 1000


async def trigger_enrich(slug: str, name: str) -> bool:
    """Fire an enrichment run for one startup, via Trigger.dev (fire-and-forget,
    like the dashboard's enrich button). Best-effort; never raises."""
    secret = os.environ.get("TRIGGER_SECRET_KEY", "")
    if not secret:
        print("enrich_job: TRIGGER_SECRET_KEY not set, cannot re-trigger enrichment")
        return False
    body = {
        "payload": {"mode": "enrich", "slug": slug, "name": name},
        "options": {},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                _TRIGGER_TRIGGER_URL,
                headers={
                    "Authorization": f"Bearer {secret}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            res.raise_for_status()
            return True
    except Exception as e:
        print(f"enrich_job: trigger_enrich failed for {slug}: {type(e).__name__}: {e}")
        return False


async def requeue_stale_enrichments() -> dict:
    """Recover enrichment work that would otherwise sit stuck or failed and need a
    human to redo it: re-triggers any startup whose enrichment either errored
    (status='failed') or was killed mid-run (status='running' but stale, i.e. the
    task never reset it). Never re-triggers 'pending' (genuinely no data) or
    'complete', so no-data startups don't loop forever. Emits a Logfire summary.
    """
    sb = _sb_client()
    rows: list[dict] = []
    try:
        failed = await _sb_call(
            lambda: sb.table("startups")
            .select("slug, name, enrichment_status")
            .eq("enrichment_status", "failed")
            .execute()
        )
        rows.extend((failed.data or []) if failed.data is not None else [])
    except Exception as e:
        print(f"enrich_job: requeue query (failed) error: {e}")
        return {"requeued": [], "error": str(e)}

    try:
        cutoff = datetime.now(timezone.utc) - timedelta(milliseconds=_STALE_RUNNING_MS)
        stale = await _sb_call(
            lambda: sb.table("startups")
            .select("slug, name, enrichment_status")
            .eq("enrichment_status", "running")
            .lt("updated_at", cutoff.isoformat())
            .execute()
        )
        rows.extend((stale.data or []) if stale.data is not None else [])
    except Exception as e:
        print(f"enrich_job: requeue query (stale) error: {e}")

    # De-dup (a row can't be both, but be safe), and skip rows that already have data.
    seen: set[str] = set()
    requeued: list[str] = []
    for r in rows:
        slug = (r.get("slug") or "").strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        try:
            # Reset to running up front (same as the dashboard's /api/enrich route)
            # so a row we successfully re-trigger isn't re-reaped by a later pass.
            await _sb_call(
                lambda: sb.table("startups")
                .update(
                    {
                        "enrichment_status": "running",
                        "enrichment_error": None,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                .eq("slug", slug)
                .execute()
            )
        except Exception as e:
            print(f"enrich_job: requeue reset failed for {slug}: {e}")
            continue
        if await trigger_enrich(slug, (r.get("name") or "").strip()):
            requeued.append(slug)
        else:
            # Failed to reach Trigger.dev — put it back to failed so it's retried
            # next pass instead of being stranded as "running".
            try:
                await _sb_call(
                    lambda: sb.table("startups")
                    .update({"enrichment_status": "failed"})
                    .eq("slug", slug)
                    .execute()
                )
            except Exception:
                pass

    with observability.span("enrich.requeue", attempted=len(rows), requeued=len(requeued)) as s:
        s.set_attribute("requeued", ",".join(requeued))
    return {"requeued": requeued, "attempted": len(rows)}


async def run_enrichment(slug: str, name: str) -> dict:
    """Public entry point — wraps the real enrichment in a Logfire span and emits an
    outcome metric + duration histogram per startup, so no enrichment is invisible:
    which slug, which gaps were filled, which source, how long it took, and whether it
    failed (observability.record_enrichment).
    """
    start = time.time()
    with observability.span("enrich.startup", slug=slug, name=(name or "")[:200]) as s:
        result = await _run_enrichment(slug, name)
        s.set_attributes(
            {
                "status": str(result.get("status", "")),
                "source": str(result.get("source", "")),
                "filled": str(result.get("filled", "")),
                "error": str(result.get("error", "")),
            }
        )
        observability.record_enrichment(
            slug,
            status=str(result.get("status", "unknown")),
            source=str(result.get("source", "")),
            filled=str(result.get("filled", "")),
            error=str(result.get("error", "")),
            duration_s=time.time() - start,
        )
        return result


async def _run_enrichment(slug: str, name: str) -> dict:
    sb = _sb_client()

    try:
        existing = await _sb_call(
            lambda: sb.table("startups").select(_ENRICH_SELECT).eq("slug", slug).single().execute()
        )
        row = existing.data or {}
        gaps = assess_enrich_gaps(row)

        if not gaps.needs_any():
            await _sb_call(
                lambda: sb.table("startups")
                .update({
                    "enrichment_status": "complete",
                    "enriched": bool(row.get("enriched") and row.get("has_email")),
                })
                .eq("slug", slug)
                .execute()
            )
            return {"status": "already_complete", "slug": slug}

        website = _text(row.get("website"))
        known = known_context_summary(row)

        partial_update: dict = {}
        connect_data = await run_enrich_connect(
            name,
            website,
            slug=slug,
            gaps=gaps,
            known_context=known,
        )
        if connect_data:
            partial_update = _merge_connect_into_update(row, connect_data, gaps) or {}
            if partial_update:
                await _sb_call(lambda: sb.table("startups").update(partial_update).eq("slug", slug).execute())
                return {"status": "enriched", "slug": slug, "source": "connect", "filled": gaps.signature()}

        row_merged = {**row, **partial_update}
        gaps_after = assess_enrich_gaps(row_merged)

        need_fallback = gaps_after.company_description or gaps_after.founders_timeline
        if not need_fallback:
            await _sb_call(
                lambda: sb.table("startups")
                .update({"enrichment_status": "complete"})
                .eq("slug", slug)
                .execute()
            )
            return {"status": "enriched", "slug": slug, "source": "connect_partial", "filled": gaps.signature()}

        company, people, founder_history = await asyncio.gather(
            search_company(f"{name} startup company"),
            search_people(f"founder CEO {name}"),
            search_company_founders(name),
        )

        structured = await structure_enrichment(name, company, people + founder_history)

        if not structured or not has_enrichment_content(structured):
            if connect_data:
                await _sb_call(
                    lambda: sb.table("startups").update({"enrichment_status": "complete"}).eq("slug", slug).execute()
                )
                return {"status": "enriched", "slug": slug, "source": "connect_partial"}
            await _sb_call(
                lambda: sb.table("startups").update({"enrichment_status": "pending"}).eq("slug", slug).execute()
            )
            return {"status": "no_data", "slug": slug}

        fb_update: dict = {"enrichment_status": "complete", "enriched": True, "has_email": row.get("has_email") or False}
        if gaps_after.company_description and structured.company_description:
            fb_update["company_description"] = structured.company_description[:1500]
        if gaps_after.company_meta:
            for field in ("founded", "location", "team_size", "stage", "raised"):
                val = getattr(structured, field, None)
                if val and not _text(row_merged.get(field)):
                    fb_update[field] = val

        if gaps_after.founders_timeline and structured.founders:
            existing_founders = row_merged.get("founders") or []
            fb_update["founders"] = [
                {
                    "name": f.name,
                    "background": f.background[:500],
                    "linkedin": f.linkedin or "",
                    "email": _normalize_email(
                        (existing_founders[i].get("email") or "")
                        if i < len(existing_founders) and isinstance(existing_founders[i], dict)
                        else ""
                    ),
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
                for i, f in enumerate(structured.founders[:5])
            ]

        if not website and structured.website:
            fb_update["website"] = structured.website.strip()

        fb_update["enrichment_error"] = None
        await _sb_call(lambda: sb.table("startups").update(fb_update).eq("slug", slug).execute())
        return {"status": "enriched", "slug": slug, "source": "fallback"}

    except Exception as e:
        print(f"run_enrichment failed for {slug}: {type(e).__name__}: {e}")
        await _sb_call(
            lambda: sb.table("startups").update({"enrichment_status": "failed", "enrichment_error": f"{type(e).__name__}: {e}"}).eq("slug", slug).execute()
        )
        return {"status": "error", "slug": slug, "error": str(e)}
