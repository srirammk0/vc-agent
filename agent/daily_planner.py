"""Daily planner — runs once each morning (06:00 America/New_York, scheduled by
Trigger.dev's daily-planner-scheduled task) and decides, with judgment rather than
a fixed replay, which approved-but-quiet startups are worth a fresh look today —
then schedules each one as a specific check at a specific time via Trigger.dev,
spread across the day rather than firing all at once.

This is the proactive half of self-scheduling; agent/signals_review.py's
schedule_signal_check (reactive, at nightly review time, over today's raw
signals) and agent/agent.py's schedule_followup (reactive, at the boss's
request) are the other two entry points into the same agent/trigger_client.py
primitive. This one looks at the portfolio-in-progress instead — approved
startups nobody's checked on in a while.

Runs once daily via daily_planner_scheduled in modal_app.py.
"""

import os
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext, ToolDefinition
from supabase import create_client

import llm
import trigger_client
from signals_scraper import gemma_filter

MAX_CHECKS_PER_RUN = 5
STALE_DAYS = 10  # only consider approved startups untouched this long

DAILY_PLANNER_RULES = """You plan today's proactive research checks for a pre-seed AI VC fund. You're
given a list of approved startups that haven't been looked at in a while (name, one-liner, days since
last update). Decide which of these — if any — are worth a fresh look today (funding/news/traction may
have changed since the boss last looked), and schedule each with schedule_check, picking a specific hour
today to spread the load rather than firing everything at once. Be selective: most days this should be
0-3 startups, not all of them — only ones where something plausibly changed. Everything you don't
schedule is left alone, there's always tomorrow."""


def _make_non_strict(ctx: RunContext, tool_def: ToolDefinition) -> ToolDefinition:
    tool_def.strict = False
    return tool_def


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


class ScheduledDailyCheck(BaseModel):
    slug: str
    due_in_hours: int = 4
    reason: str = ""


def _build_agent() -> Agent:
    """Fresh Agent + tools per run so MAX_CHECKS_PER_RUN is a real per-run cap,
    not accumulated state across cron fires."""
    agent = Agent(
        llm.model,
        instructions=DAILY_PLANNER_RULES,
        model_settings=llm.FINALIZE_FEEDBACK_SETTINGS,
    )
    scheduled_this_run = {"n": 0}

    @agent.tool(prepare=_make_non_strict)
    async def schedule_check(ctx: RunContext, checks: list[ScheduledDailyCheck]) -> str:
        """Schedule a fresh-look check on a startup later today. due_in_hours: hours from
        now — spread these out across different startups (e.g. 2, 4, 6, 8) rather than
        stacking them all at the same time. Capped at a handful per run."""
        if scheduled_this_run["n"] >= MAX_CHECKS_PER_RUN:
            return f"[limit reached: already scheduled {MAX_CHECKS_PER_RUN} this run, skipping the rest]"

        scheduled, skipped = [], []
        today = datetime.now(timezone.utc).date().isoformat()
        for check in checks:
            if scheduled_this_run["n"] >= MAX_CHECKS_PER_RUN:
                skipped.append(f"{check.slug} (run limit)")
                continue
            due_at = datetime.now(timezone.utc) + timedelta(hours=max(check.due_in_hours, 1))
            ok = await trigger_client.schedule_check(
                "daily_check",
                {"slug": check.slug, "reason": check.reason},
                due_at,
                idempotency_key=f"daily_check:{check.slug}:{today}",
            )
            if not ok:
                skipped.append(f"{check.slug} (trigger.dev scheduling failed)")
                continue
            scheduled_this_run["n"] += 1
            scheduled.append(check.slug)

        lines = [f"Scheduled {len(scheduled)} check(s)."]
        if skipped:
            lines.append(f"Skipped: {'; '.join(skipped)}")
        return "\n".join(lines)

    return agent


async def run_daily_planner() -> dict:
    rows = _load_stale_approved()
    if not rows:
        print("daily_planner: nothing stale to plan for.")
        return {"planned": 0}

    items_text = "\n".join(
        f"[slug={r['slug']}] {r.get('name', '')} — {r.get('one_liner', '')} "
        f"(last updated {r.get('updated_at', '')})"
        for r in rows
    )

    agent = _build_agent()
    prompt = (
        f"Here are {len(rows)} approved startups untouched for {STALE_DAYS}+ days. "
        f"Decide which (if any) deserve a fresh look today.\n\n{items_text}"
    )

    try:
        res = await llm.run_with_retry(agent, prompt)
        print("daily_planner:", res.output)
        return {"planned": len(rows), "reply": res.output}
    except Exception as e:
        if llm._is_rate_limit_error(e):
            print("daily_planner: rate limited, skipping this run")
            return {"planned": 0, "error": "rate_limited"}
        raise


async def run_daily_check(payload: dict) -> str | None:
    """Fired for a 'daily_check' task scheduled via Trigger.dev. One fresh Exa search
    on the startup + one Gemma call (same pattern as signals_scraper.recheck_signal) to
    decide if something genuinely changed; returns an SMS-worthy summary if so, None
    otherwise (silent)."""
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
                contents={"text": {"max_characters": 1500}, "max_age_hours": 24 * STALE_DAYS},
            ),
            timeout=30.0,
        )
        findings = "\n".join(
            f"Title: {r.title}\nURL: {r.url}\nContent: {getattr(r, 'text', '') or ''}\n---"
            for r in getattr(exa_res, "results", [])
        ) or "No new results found."
    except Exception as e:
        print(f"daily_planner: Exa search failed for {name}: {e}")
        return None

    candidate = {
        "platform": "daily_check", "title": name,
        "signal_type": "Portfolio re-check", "score": 0,
        "snippet": findings[:1500],
    }
    approved = await gemma_filter([candidate], strict_hard_filters=False, blocked_names=None)
    if not approved:
        return None

    conviction = approved[0].get("score", 0)
    # Defense in depth: gemini_reasoning ends up verbatim in an SMS to the boss below —
    # never let it carry more than a short plain-text summary.
    reasoning = " ".join(str(approved[0].get("gemini_reasoning", "")).split())[:200]
    if not isinstance(conviction, int) or conviction < 7:
        return None

    try:
        sb.table("startups").update({
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("slug", slug).execute()
    except Exception as e:
        print(f"daily_planner: failed to bump updated_at for {slug}:", e)

    return f"portfolio check on {name}: {reasoning}"
