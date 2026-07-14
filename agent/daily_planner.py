"""Daily planner — runs once each morning (06:00 America/New_York, scheduled by
Trigger.dev's daily-planner-scheduled task) and decides, with judgment rather than
a fixed replay, which approved-but-quiet startups are worth a fresh look today.

This no longer has its own mini-agent or scheduling tool — it builds a prompt from
today's stale-approved startups and runs it through agent.py's assistant_agent, the
exact same pipeline used for text and dashboard chat. Deciding what needs a look is
just another kind of turn for that one agent; scheduling each check uses the same
schedule_agent_run tool the boss can trigger themselves, capped for this run via
AgentDeps.schedule_budget so an unattended cron run can't schedule unboundedly.

surface="text" here only picks the reply STYLE (plain, lowercase — this reply gets
SMS'd as the boss's morning digest), not who gets notified later: phone_number is
left empty, so any schedule_agent_run calls made during this run don't carry a
sender — each fresh-look check it schedules resolves on the dashboard's Scheduled
Runs page when it fires, not as its own individual text (see agent.py's
run_scheduled_agent_run). The one digest reply from THIS run is still texted by
modal_app.py's daily_planner_scheduled endpoint, unchanged.
"""

import os
from datetime import datetime, timedelta, timezone

from supabase import create_client

from agent import AgentDeps, agent_run_with_retry, assistant_agent, _known_startups_context

MAX_CHECKS_PER_RUN = 5
STALE_DAYS = 10  # only consider approved startups untouched this long


def _sb_client():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    return create_client(url, key)


def _load_stale_approved() -> list[dict]:
    sb = _sb_client()
    if sb is None:
        return []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat()
    try:
        res = (
            sb.table("startups")
            .select("slug, name, one_liner, updated_at")
            .eq("status", "approved")
            .lte("updated_at", cutoff)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print("daily_planner: failed to load stale approved startups:", e)
        return []


_DAILY_REVIEW_PROMPT = """Today's proactive portfolio review. Here are {n} approved startups that \
haven't been looked at in {stale_days}+ days (name, one-liner, days since last update):

{items}

Decide which of these — if any — are worth a fresh look today (funding/news/traction may have \
changed since the boss last looked). For each one worth checking, call schedule_agent_run with a \
short due_in_minutes so checks land spread across today (e.g. 120, 240, 360...) rather than all at \
once, and instructions describing what to check on that startup and why. Be selective — most days \
this should be 0-3 startups, not all of them. You have a hard cap of {max_checks} schedule_agent_run \
calls this run; anything you don't schedule is left for another day, there's always tomorrow.

Reply with a short, plain summary of what (if anything) you're checking on today and why, one line \
per startup — this gets texted directly to the boss as a morning digest, so keep it lowercase, \
casual, and free of markdown."""


async def run_daily_planner() -> dict:
    rows = _load_stale_approved()
    if not rows:
        msg = "daily check-in: nothing stale enough to warrant a fresh look today."
        print("daily_planner:", msg)
        return {"planned": 0, "reply": msg}

    items_text = "\n".join(
        f"[slug={r['slug']}] {r.get('name', '')} — {r.get('one_liner', '')} "
        f"(last updated {r.get('updated_at', '')})"
        for r in rows
    )
    prompt = _DAILY_REVIEW_PROMPT.format(
        n=len(rows), stale_days=STALE_DAYS, items=items_text, max_checks=MAX_CHECKS_PER_RUN
    )
    prompt = f"{await _known_startups_context()}\n\n{prompt}"

    deps = AgentDeps(
        phone_number="",
        from_number="",
        sb_key="",
        sb_secret="",
        message_handle=None,
        surface="text",
        schedule_budget={"max": MAX_CHECKS_PER_RUN, "used": 0},
    )

    try:
        res = await agent_run_with_retry(assistant_agent, prompt, deps=deps)
        print("daily_planner:", res.output)
        return {"planned": len(rows), "reply": res.output}
    except Exception as e:
        import llm
        if llm._is_rate_limit_error(e):
            print("daily_planner: rate limited, skipping this run")
            return {"planned": 0, "error": "rate_limited"}
        raise


async def run_daily_check(payload: dict) -> str | None:
    """Legacy handler kept for backward compatibility with any 'daily_check' tasks
    already scheduled by the old per-run schedule_check tool before this rewrite —
    new daily-planner runs schedule 'agent_followup' via schedule_agent_run instead
    (see run_daily_planner above), which goes through run_scheduled_agent_run in
    agent.py, not this function. Safe to delete once no old-style tasks remain
    pending (they're same-day, so this window is short)."""
    slug = payload.get("slug", "")
    if not slug:
        return None

    sb = _sb_client()
    if sb is None:
        return None
    try:
        res = sb.table("startups").select("name, one_liner").eq("slug", slug).single().execute()
        row = res.data or {}
    except Exception as e:
        print(f"daily_planner: failed to load startup {slug}:", e)
        return None

    name = row.get("name", slug)
    if not name:
        return None

    from tools.exa import exa
    import asyncio

    try:
        exa_res = await asyncio.wait_for(
            asyncio.to_thread(
                exa.search,
                f"{name} startup funding launch news",
                num_results=3,
                contents={"text": {"max_characters": 500}, "max_age_hours": 24 * STALE_DAYS},
            ),
            timeout=30.0,
        )
        top = next(iter(getattr(exa_res, "results", [])), None)
    except Exception as e:
        print(f"daily_planner: Exa search failed for {name}: {e}")
        return f"portfolio check on {name}: search failed, couldn't check today."

    try:
        sb.table("startups").update({
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("slug", slug).execute()
    except Exception as e:
        print(f"daily_planner: failed to bump updated_at for {slug}:", e)

    if not top:
        return f"portfolio check on {name}: nothing new turned up."
    title = (getattr(top, "title", "") or "").strip()
    url = (getattr(top, "url", "") or "").strip()
    if not title:
        return f"portfolio check on {name}: found something but no clean summary — worth a manual look."
    return f"portfolio check on {name}: {title}" + (f" — {url}" if url else "")
