import hashlib
import os
import json
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Literal
import urllib.request
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext, ToolDefinition
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.usage import UsageLimits

from tools.exa import exa
from tools import linkup
import memory_store as sm
import startups_store
import cache
import llm
import trigger_client
import scheduled_tasks_log
import prompts

_EXA_DEEP_TTL_SECONDS = 6 * 3600
# Ceiling on model round-trips within a single run — a normal sweep/reply is a
# handful of tool calls, so this is the worst-case blast radius if a tool loop
# ever goes bad, not a normal-case budget.
_USAGE_LIMITS = UsageLimits(request_limit=30)

# schedule_agent_run bounds: default ceiling keeps the agent's own judgment calls
# short-term; boss_specified_duration=True (only when the boss stated an explicit
# longer timeframe themselves) unlocks the higher absolute ceiling instead.
DEFAULT_MAX_FOLLOWUP_MINUTES = 3 * 24 * 60  # 3 days
ABSOLUTE_MAX_FOLLOWUP_MINUTES = 30 * 24 * 60  # 30 days, hard cap regardless

model = llm.model

RATE_LIMIT_REPLY = (
    "models are getting hammered rn - give it a min and try again"
)

_CONVO_TTL_SECONDS = 24 * 3600
_CONVO_MAX_MESSAGES = 20  # ~10 back-and-forth turns, pure rolling window — no summarization


def _convo_key(sender: str) -> str:
    # Normalize through _e164 first — SendBlue's webhook payload doesn't
    # consistently format the sender (with/without "+1", from_number vs
    # number), so raw digit-stripping alone can hash the same phone number
    # to two different keys and silently drop history between messages.
    normalized = _e164(sender) or (sender or "")
    digits = "".join(c for c in normalized if c.isdigit())
    return f"conv:{digits}"


async def _load_history(sender: str) -> list:
    try:
        data = await cache.cache_get(_convo_key(sender), _CONVO_TTL_SECONDS)
        if data:
            return ModelMessagesTypeAdapter.validate_python(data)
    except Exception as e:
        print("failed to load conversation history:", e)
    return []


def _drop_orphaned_tool_returns(messages: list) -> list:
    """A raw tail-slice can cut a ModelResponse's ToolCallPart while keeping the
    following ModelRequest's ToolReturnPart, which Anthropic's API rejects (this is
    what llm.is_broken_history_error was catching). Drop leading messages until the
    window doesn't start mid tool-call/tool-result exchange."""
    while messages and any(
        type(part).__name__ == "ToolReturnPart" for part in getattr(messages[0], "parts", [])
    ):
        messages = messages[1:]
    return messages


async def _save_history(sender: str, messages: list) -> None:
    try:
        trimmed = _drop_orphaned_tool_returns(messages[-_CONVO_MAX_MESSAGES:])
        data = ModelMessagesTypeAdapter.dump_python(trimmed, mode="json")
        await cache.cache_set(_convo_key(sender), data)
    except Exception as e:
        print("failed to save conversation history:", e)


async def append_alert_to_history(message: str, recipients: list[str]) -> dict:
    """Append a scheduled-job alert (e.g. the daily portfolio digest SMS) to a recipient's
    conversation history as if the assistant had just said it, so a follow-up text from
    the boss has that context without re-fetching it from Supermemory."""
    if not message or not recipients:
        return {"appended": []}
    appended = []
    for recipient in recipients:
        if not recipient:
            continue
        history = await _load_history(recipient)
        history.append(ModelResponse(parts=[TextPart(content=message)]))
        await _save_history(recipient, history)
        appended.append(recipient)
    return {"appended": appended}


class FounderPositionSave(BaseModel):
    company: str
    title: str
    start_date: str = ""
    end_date: str = ""
    is_current: bool = False
    description: str = ""


class FounderSave(BaseModel):
    name: str
    background: str = ""
    linkedin: str = ""
    positions: list[FounderPositionSave] = Field(default_factory=list)
    credibility_note: str = Field(
        default="",
        description="ONE sentence, not a paragraph — name the specific prior company/role that actually supports it, or say plainly that nothing concrete was found.",
    )


class StartupSave(BaseModel):
    slug: str
    name: str
    website: str = ""
    one_liner: str
    assessment: str
    signal_urls: list[str] = Field(default_factory=list)
    founders: list[FounderSave] = Field(
        default_factory=list,
        description=(
            "Only for stealth candidates you've already researched (see the stealth founder "
            "research rule) — leave empty otherwise, non-stealth founder data comes from the "
            "dashboard's separate Enrich flow instead."
        ),
    )


class PreferenceWrite(BaseModel):
    pattern: str
    type: str = "approved"


class LinkupSearchQuery(BaseModel):
    q: str
    include_domains: list[str] = Field(default_factory=list)
    depth: str = "standard"
    from_date: str = ""


async def agent_run_with_retry(agent: Agent, prompt: str, **kwargs):
    kwargs.setdefault("usage_limits", _USAGE_LIMITS)
    return await llm.run_with_retry(agent, prompt, **kwargs)


def _tool_call_result(result, tool_name: str) -> str | None:
    """Return the ToolReturnPart content for the last call to tool_name in this run,
    or None if it was never called. Used to verify save_startups actually ran (and
    actually saved something) instead of trusting the model said it would."""
    content = None
    for msg in result.all_messages():
        for part in getattr(msg, "parts", []):
            if type(part).__name__ == "ToolReturnPart" and part.tool_name == tool_name:
                content = str(part.content)
    return content


@dataclass
class AgentDeps:
    """Per-run dependencies for the unified assistant agent.

    surface picks the reply style/UI tail (see prompts.build_instructions) — "text"
    for anything that ends up as an iMessage (inbound texts, and any scheduled run
    whose result gets SMS'd back), "web" for anything that renders on the dashboard.

    phone_number is the SMS-notify target for schedule_agent_run — empty means "no
    phone attached to this run", so anything it schedules resolves on the dashboard
    only, never as an SMS, when it later fires.

    schedule_budget optionally caps how many schedule_agent_run calls succeed within
    one run — None means unlimited, which is the case for every boss-initiated
    conversation.

    background marks a scheduled/autonomous self-run (see run_scheduled_agent_run) —
    orthogonal to surface, which only picks which tools/reply-target apply (SMS vs
    dashboard). background overrides the closing style tail regardless of surface:
    no generative UI, no rich Markdown, a 2-sentence outcome report instead of a full
    reply — since nobody is reading this live (see prompts.build_instructions).
    """
    phone_number: str
    from_number: str
    sb_key: str
    sb_secret: str
    message_handle: str = None
    surface: Literal["text", "web"] = "web"
    schedule_budget: dict | None = None
    background: bool = False


def _e164(phone: str | None) -> str | None:
    if not phone or phone == "system":
        return None
    phone = phone.strip()
    if phone.startswith("+"):
        return phone
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}" if digits else None


async def assistant_instructions(ctx: RunContext[AgentDeps]) -> str:
    """The one instructions function for every surface — inbound text, dashboard
    chat, and the agent's own scheduled/autonomous runs all go through the exact
    same tool routing; only the closing style tail differs by ctx.deps.surface (and,
    for a scheduled/background run, ctx.deps.background — see AgentDeps/
    prompts.build_instructions for why that overrides surface's normal style pick).

    thesis/preferences only (see prompts.build_instructions' docstring for why the
    known-startups list is deliberately NOT here) — fetched in parallel since
    they're independent Supermemory calls, not sequential round-trips."""
    thesis, preferences = await asyncio.gather(sm.load_thesis(), sm.load_preferences())
    surface = ctx.deps.surface if ctx.deps else "web"
    background = ctx.deps.background if ctx.deps else False
    return prompts.build_instructions(surface, thesis=thesis, preferences=preferences, background=background)


def make_non_strict(ctx: RunContext, tool_def: ToolDefinition) -> ToolDefinition:
    tool_def.strict = False
    return tool_def


def _format_duration(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} minute(s)"
    if minutes < 1440:
        return f"{minutes / 60:g} hour(s)"
    return f"{minutes / 1440:g} day(s)"


async def _exa_deep_search_one(query: str) -> str:
    cache_key = cache.make_key("exa:deep", query)
    cached = await cache.cache_get(cache_key, _EXA_DEEP_TTL_SECONDS)
    if cached is not None:
        return cached
    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(
                exa.search,
                query,
                num_results=5,
                contents={
                    "text": {"max_characters": 3500},
                    "max_age_hours": 168,
                },
            ),
            timeout=30.0,
        )
        results = []
        for r in getattr(res, "results", []):
            content = r.text if hasattr(r, "text") and r.text else "No content"
            results.append(f"Title: {r.title}\nURL: {r.url}\nContent: {content}\n---")
        output = "\n".join(results) if results else "No results found."
    except asyncio.TimeoutError:
        return "[exa timeout — skip this query and try a different search term]"
    except Exception as e:
        return f"[exa search failed: {e} — try a different search term]"

    if results:
        await cache.cache_set(cache_key, output)
    return output


def register_tools(
    agent: Agent,
    *,
    dealflow: bool = True,
    thesis_update: bool = True,
    tapback: bool = True,
    exa: bool = True,
    linkup_tools: bool = False,
    follow_up: bool = False,
    reflection_source: str | None = None,
):
    _T = "[tool timed out — skip this step and continue]"

    def _err(e: Exception) -> str:
        return f"[tool error: {type(e).__name__}: {e} — try different params or skip]"

    if exa:

        _EXA_MAX_QUERIES = 8

        @agent.tool(prepare=make_non_strict)
        async def exa_deep_search_many(ctx: RunContext, queries: list[str]) -> str:
            """Run Exa searches in parallel for startup discovery and deep research. Use even for a single query — pass a one-element list. Hard cap 8 queries per call — pass a well-diversified set (4-6 is a good sweep); anything past 8 is dropped, and near-duplicate queries waste a slot for no new signal."""
            if not queries:
                return "No queries provided."
            # Enforced in code, not just prompt: de-dup near-identical queries (case/whitespace
            # only — a real dedup, not fuzzy) before capping, so two queries that differ only in
            # casing don't eat two of the five slots for the same search.
            seen = set()
            deduped = []
            for q in queries:
                key = " ".join(q.lower().split())
                if key and key not in seen:
                    seen.add(key)
                    deduped.append(q)
            trimmed = deduped[:_EXA_MAX_QUERIES]
            try:
                parts = await asyncio.gather(*[_exa_deep_search_one(q) for q in trimmed])
                result = "\n\n".join(
                    f"=== Query: {query} ===\n{part}" for query, part in zip(trimmed, parts)
                )
                if len(trimmed) < len(queries):
                    result += f"\n\n[{len(queries) - len(trimmed)} additional quer{'y' if len(queries) - len(trimmed) == 1 else 'ies'} dropped — duplicate or over the 5-query cap]"
                return result
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

    if linkup_tools:

        @agent.tool(prepare=make_non_strict)
        async def linkup_search(
            ctx: RunContext,
            q: str,
            depth: str = "standard",
            include_domains: list[str] | None = None,
            from_date: str = "",
        ) -> str:
            """Linkup web search for news, facts, or domain-filtered results. depth: fast, standard, or deep."""
            try:
                return await linkup.search(
                    q,
                    depth=depth,
                    include_domains=include_domains or None,
                    from_date=from_date or None,
                )
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        _LINKUP_MAX_QUERIES = 8  # matches exa_deep_search_many's cap — this tool had
        # no bound at all before, so a model that decided to pass 20+ queries in one
        # call would just fan all of them out with nothing to stop it.

        @agent.tool(prepare=make_non_strict)
        async def linkup_search_many(
            ctx: RunContext,
            queries: list[LinkupSearchQuery],
            from_date: str = "",
        ) -> str:
            """Run multiple Linkup searches in parallel. Use for news digest buckets with include_domains. Hard cap 8 queries per call — anything past 8 is dropped."""
            try:
                trimmed = queries[:_LINKUP_MAX_QUERIES]
                specs = [q.model_dump() for q in trimmed]
                default_from = from_date or linkup.week_ago_date()
                result = await linkup.search_many(specs, default_from_date=default_from)
                if len(trimmed) < len(queries):
                    result += f"\n\n[{len(queries) - len(trimmed)} additional quer{'y' if len(queries) - len(trimmed) == 1 else 'ies'} dropped — over the 8-query cap]"
                return result
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def linkup_fetch(ctx: RunContext, url: str) -> str:
            """Fetch full page markdown from a URL when you already know the link."""
            try:
                return await linkup.fetch(url, render_js=True)
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

    @agent.tool(prepare=make_non_strict)
    async def supermemory_search(ctx: RunContext, query: str, container_tag: str = "vc:preferences") -> str:
        """Search the agent's own memory semantically. container_tag: vc:thesis, vc:preferences, vc:reflections, vc:market-intel. Startups are NOT in here — use crosscheck_startups/query_startups for dealflow."""
        try:
            return await sm.semantic_search(query, container_tag)
        except asyncio.TimeoutError:
            return _T
        except Exception as e:
            return _err(e)

    if dealflow:

        @agent.tool(prepare=make_non_strict)
        async def crosscheck_startups(ctx: RunContext, names: list[str]) -> str:
            """Check whether one or more company names already exist anywhere in dealflow
            (the FULL table, not just the recently-updated slice you already see in
            context) — an exact normalized-name match (case/punctuation/spacing-insensitive),
            NOT a fuzzy text search of names or one-liners. That distinction matters: a loose
            substring search would flag a brand-new company as "already known" just because
            its name shares a word with some unrelated startup's description. This tool only
            reports a real match, so "not found" is a genuine guarantee, not a guess.

            ALWAYS pass every candidate name in ONE call — a one-element list for a single
            company ("do we know X", "what's the status on X", "find the slug for X"), or every
            name from a sourcing run at once before save_startups. Never call this once per
            name in a loop. For anything broader than checking specific names — a list matching
            some criteria — use query_startups instead."""
            try:
                return await startups_store.crosscheck_startups(names)
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def query_startups(
            ctx: RunContext,
            status: str | None = None,
            stealth: bool | None = None,
            linkedin_status: str | None = None,
            email_status: str | None = None,
            followed_up: bool | None = None,
            offset: int = 0,
        ) -> str:
            """Scan dealflow by structured filters (status: new/approved/passed; stealth:
            true/false; linkedin_status/email_status: not_contacted/contacted/replied;
            followed_up: true = chased at least once, false = never followed up),
            paginated ~40 rows per call so one call never dumps the whole table. Use this
            for anything broader than one named company — "which approved startups haven't
            been emailed", "who have we never followed up with", "how many are in stealth",
            a full audit of some slice of dealflow. Leave a filter as null to not filter
            on it.

            Every row also reports its follow-up count and the date of the last one, so
            "we've chased them 3 times since March with no reply" is answerable from one
            call. You can't change follow-up counts — logging a follow-up is a dashboard
            action, same as approve/pass.

            The result tells you how many total rows matched and whether more remain. If
            the boss wants the COMPLETE list (not just a sample) and more remain, call this
            again with offset set to the number already shown — keep going until you've
            covered the full total, don't stop after one page and imply that's everything
            unless it actually is."""
            try:
                return await startups_store.query_startups(
                    status=status,
                    stealth=stealth,
                    linkedin_status=linkedin_status,
                    email_status=email_status,
                    followed_up=followed_up,
                    offset=offset,
                )
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def save_startups(ctx: RunContext, startups: list[StartupSave]) -> str:
            """Save new startups directly to Supabase. slug must be a lowercase hyphenated identifier (e.g. 'acme-ai'). Use even for one startup — pass a one-element list. No automated filter runs on these — you are the only check, so only pass candidates you've already held against the thesis yourself. Startups already in dealflow (matched by name or slug) are automatically skipped, not re-saved — check the result for any "already known" entries and don't treat those as new finds.

            founders: only set this for stealth candidates you've already researched per the stealth
            founder research rule — real career history and a grounded credibility read, never
            invented. Leave empty for non-stealth candidates (their founder data comes later, from the
            dashboard's separate Enrich flow) and for stealth candidates where your research genuinely
            turned up nothing usable."""
            if not startups:
                return "No startups provided."
            try:
                items = [s.model_dump() for s in startups]
                saved, skipped, errors = await startups_store.save_startups_batch(items)
                lines = [f"Saved {len(saved)} startup(s): {', '.join(saved) or 'none'}"]
                if skipped:
                    lines.append(f"Skipped {len(skipped)} already-known: {'; '.join(skipped)}")
                if errors:
                    lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
                return "\n".join(lines)
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def delete_startups(ctx: RunContext, slugs: list[str]) -> str:
            """Permanently delete startups from Supabase (and the dashboard). Use for duplicates, mistakes, or bad saves — not for rejecting a startup on merits (status changes are dashboard-only now, you have no tool for that). IMPORTANT: slug must be exact — call crosscheck_startups([name]) first if unsure. Use even for one startup — pass a one-element list."""
            if not slugs:
                return "No slugs provided."
            try:
                deleted, errors = await startups_store.delete_startups_batch(slugs)
                lines = [f"Deleted {len(deleted)} startup(s): {', '.join(deleted) or 'none'}"]
                if errors:
                    lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
                return "\n".join(lines)
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

    @agent.tool(prepare=make_non_strict)
    async def write_preferences(ctx: RunContext, preferences: list[PreferenceWrite]) -> str:
        """Save seek/avoid patterns. type: 'approved' (seek) or 'passed' (avoid). Use even for one pattern — pass a one-element list."""
        if not preferences:
            return "No preferences provided."
        try:
            items = [p.model_dump() for p in preferences]
            count, errors = await sm.write_preferences_batch(items)
            lines = [f"Saved {count} preference(s)."]
            if errors:
                lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
            return "\n".join(lines)
        except asyncio.TimeoutError:
            return _T
        except Exception as e:
            return _err(e)

    @agent.tool(prepare=make_non_strict)
    async def list_preferences(ctx: RunContext) -> str:
        """List every saved seek/avoid pattern with its ID. Call this before delete_preferences if you don't have the exact ID."""
        try:
            return await sm.list_preferences()
        except asyncio.TimeoutError:
            return _T
        except Exception as e:
            return _err(e)

    @agent.tool(prepare=make_non_strict)
    async def delete_preferences(ctx: RunContext, pattern_ids: list[str]) -> str:
        """Delete saved seek/avoid patterns by ID (the bracketed ID from list_preferences, e.g. 'approved-a1b2c3d4'). Use when a learned pattern turns out wrong or outdated. Use even for one pattern — pass a one-element list."""
        if not pattern_ids:
            return "No pattern IDs provided."
        try:
            deleted, errors = await sm.delete_preferences_batch(pattern_ids)
            lines = [f"Deleted {len(deleted)} preference(s): {', '.join(deleted) or 'none'}"]
            if errors:
                lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
            return "\n".join(lines)
        except asyncio.TimeoutError:
            return _T
        except Exception as e:
            return _err(e)

    @agent.tool(prepare=make_non_strict)
    async def write_reflection(ctx: RunContext, reflection: str) -> str:
        """Write a post-run self-improvement note about how the run went and what to do differently."""
        # reflection_source is fixed for narrow single-purpose agents (e.g. feedback_agent);
        # for the unified assistant agent it's None here and resolved per-run from
        # ctx.deps.surface instead, since one Agent object now serves every surface.
        source = reflection_source or (ctx.deps.surface if getattr(ctx, "deps", None) else "unknown")
        try:
            await sm.write_reflection(reflection, source=source)
            return "Saved reflection."
        except asyncio.TimeoutError:
            return _T
        except Exception as e:
            return _err(e)

    if follow_up:

        @agent.tool(prepare=make_non_strict)
        async def schedule_agent_run(
            ctx: RunContext[AgentDeps],
            due_in_minutes: int,
            instructions: str,
            boss_specified_duration: bool = False,
        ) -> str:
            """Schedule a real future run of yourself — you'll wake up later and act on
            `instructions` autonomously, with the same tools you have right now. Use this
            for follow-ups the boss asks for, or checks you decide yourself are worth doing
            later rather than promising from memory. due_in_minutes: minutes from now —
            convert whatever timeframe was given (20 minutes -> 20, 2 hours -> 120, 2 days
            -> 2880). boss_specified_duration: set True ONLY when the boss explicitly stated
            a longer timeframe themselves (e.g. 'check back in a month') — leave False for
            your own judgment calls like 'probably worth revisiting in a couple weeks',
            which get capped at 3 days instead. instructions: what to check/do when it
            fires, written as a reminder to yourself. Every scheduled run and its outcome
            appears on the dashboard's Scheduled Runs page; if this conversation has a
            phone number attached, you'll also get a text when it fires."""
            deps = ctx.deps
            budget = deps.schedule_budget if deps else None
            if budget is not None and budget.get("used", 0) >= budget.get("max", 0):
                return f"[scheduling budget reached for this run: already scheduled {budget.get('max')}, skipping the rest]"
            try:
                ceiling = ABSOLUTE_MAX_FOLLOWUP_MINUTES if boss_specified_duration else DEFAULT_MAX_FOLLOWUP_MINUTES
                requested = due_in_minutes
                due_in_minutes = min(max(due_in_minutes, 1), ceiling)
                due_at = datetime.now(timezone.utc) + timedelta(minutes=due_in_minutes)
                sender = deps.phone_number if deps and deps.phone_number else None
                payload: dict = {"instructions": instructions}
                if sender:
                    payload["sender"] = sender
                idempotency_source = f"{sender or 'dashboard'}:{due_at.isoformat()}:{instructions}"
                idempotency_key = "agent_followup:" + hashlib.sha1(idempotency_source.encode()).hexdigest()
                ok = await trigger_client.schedule_check(
                    "agent_followup",
                    payload,
                    due_at,
                    idempotency_key=idempotency_key,
                )
                if not ok:
                    return "[failed to schedule — trigger.dev call didn't succeed, try again]"
                if budget is not None:
                    budget["used"] = budget.get("used", 0) + 1
                reply = f"Scheduled a self-run in {_format_duration(due_in_minutes)}."
                if due_in_minutes < requested:
                    reply += " (capped — let me know if you really want it further out)"
                return reply
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def list_scheduled_tasks(ctx: RunContext[AgentDeps]) -> str:
            """List everything currently scheduled (follow-ups, checks) that hasn't fired
            yet, soonest first. Use this when the boss asks what's scheduled/pending, to
            check for a duplicate before scheduling something new, or to find the id to
            pass to delete_scheduled_task. The dashboard's Scheduled Runs page shows the
            same list plus past runs and their outcomes."""
            try:
                pending = scheduled_tasks_log.list_pending()
                if not pending:
                    return "Nothing currently scheduled."
                lines = []
                for t in pending:
                    tid = t.get("id", "?")
                    due = t.get("due_at", "?")
                    kind = t.get("kind", "?")
                    payload = t.get("payload") or {}
                    detail = payload.get("instructions") or payload.get("notes") or payload.get("reason") or ""
                    lines.append(f"- [{tid}] [{kind}] due {due}" + (f" — {detail}" if detail else ""))
                return "\n".join(lines)
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def delete_scheduled_task(ctx: RunContext[AgentDeps], task_id: str) -> str:
            """Cancel a pending scheduled task (a follow-up that hasn't fired yet) so it
            genuinely won't happen — not just removed from the list. task_id is the
            bracketed id shown by list_scheduled_tasks; call that first if you don't
            have it."""
            try:
                status = await trigger_client.cancel_scheduled_task(task_id)
                if status == "not_found":
                    return f"[no scheduled task found with id {task_id} — call list_scheduled_tasks to check]"
                if status == "cancel_failed":
                    return "[failed to cancel — trigger.dev call didn't succeed, try again]"
                if status == "canceled":
                    return "Canceled that scheduled task."
                return (
                    "Removed it from the schedule, but this one predates run tracking so I "
                    "can't confirm the underlying job was actually stopped — keep an eye out."
                )
            except Exception as e:
                return _err(e)

    if thesis_update:

        @agent.tool(prepare=make_non_strict)
        async def update_thesis(ctx: RunContext, new_content: str) -> str:
            """Update the investment thesis when the boss requests a change in criteria."""
            try:
                await sm.update_thesis(new_content)
                return "Updated the investment thesis."
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

    if tapback:

        @agent.tool(prepare=make_non_strict)
        def send_tapback_reaction(ctx: RunContext[AgentDeps], reaction: str) -> str:
            """Send an iMessage tapback reaction. Valid: 'love', 'like', 'dislike', 'laugh', 'emphasize', 'question'. Only works on the texting surface — no-ops with an explanatory error anywhere else (dashboard chat, scheduled runs with no phone attached)."""
            deps = ctx.deps
            if not deps or not deps.message_handle:
                return "Cannot send reaction: message_handle is missing."

            headers = {
                "sb-api-key-id": deps.sb_key,
                "sb-api-secret-key": deps.sb_secret,
                "Content-Type": "application/json",
            }

            try:
                req = urllib.request.Request(
                    "https://api.sendblue.co/api/send-reaction",
                    data=json.dumps({
                        "number": deps.phone_number,
                        "from_number": deps.from_number,
                        "message_handle": deps.message_handle,
                        "reaction": reaction
                    }).encode("utf-8"),
                    headers=headers,
                    method="POST"
                )
                urllib.request.urlopen(req)
                return f"Successfully sent '{reaction}' reaction."
            except Exception as e:
                return f"Failed to send reaction: {e}"


# ---- Agents ----

# One agent for every surface — inbound text, dashboard chat, and the agent's own
# scheduled/autonomous runs. Built once as a module-level singleton (not per-request):
# none of its registered tools carry per-request state of their own — everything
# request-specific (phone number, style, scheduling budget, message history) flows
# through AgentDeps and the caller-supplied message_history, so sharing this immutable
# Agent + tool-schema object across every caller is safe, the same way the old
# text_agent singleton already worked across every phone number.
assistant_agent = Agent(
    model,
    deps_type=AgentDeps,
    model_settings=llm.FINALIZE_SMS_SETTINGS,
)
assistant_agent.instructions(assistant_instructions)
register_tools(
    assistant_agent,
    dealflow=True,
    thesis_update=True,
    tapback=True,
    exa=True,
    linkup_tools=True,
    follow_up=True,
    reflection_source=None,
)

feedback_agent = Agent(
    llm.fast_model,
    instructions=prompts.FEEDBACK_RULES,
    model_settings=llm.FINALIZE_FEEDBACK_SETTINGS,
)
# dealflow=False: this agent's only job is distilling a dashboard approve/pass reason
# into a preference (see prompts.FEEDBACK_RULES), and its prompt embeds user-submitted
# free text. Registering the dealflow tools gave that text a path to save_startups and
# delete_startups — permanent data loss one successful injection away, for tools the
# agent is told never to use. It keeps write_preferences/write_reflection, which is all
# FEEDBACK_RULES actually asks of it.
register_tools(
    feedback_agent,
    dealflow=False,
    thesis_update=False,
    tapback=False,
    exa=False,
    linkup_tools=False,
    follow_up=False,
    reflection_source="feedback",
)


# --- MAIN LOGIC ENTRANCES ---

def _default_deps(
    sender: str = None,
    message_handle: str = None,
    surface: Literal["text", "web"] = "text",
    background: bool = False,
) -> AgentDeps:
    # The ALERT_PHONE_NUMBER fallback only makes sense for the texting surface (so
    # tapback/schedule_agent_run always have a real target even if sender wasn't
    # passed for some reason) — a dashboard-originated run with no explicit sender
    # should stay phone-less, so anything it schedules resolves on the dashboard only.
    if surface == "text":
        recipient = _e164(sender) or _e164(os.environ.get("ALERT_PHONE_NUMBER", "")) or ""
    else:
        recipient = _e164(sender) or ""
    return AgentDeps(
        phone_number=recipient,
        from_number=_e164(os.environ.get("SENDBLUE_FROM_NUMBER", "")) or "",
        sb_key=os.environ.get("SENDBLUE_API_KEY", ""),
        sb_secret=os.environ.get("SENDBLUE_API_SECRET", ""),
        message_handle=message_handle,
        surface=surface,
        background=background,
    )


async def run_text_handler(message: str, slug: str = None, sender: str = None, message_handle: str = None) -> dict:
    prompt = f"The boss sent this message: '{message}'. Handle it."
    if slug:
        prompt += f" Context startup slug: {slug}."

    deps = _default_deps(sender=sender, message_handle=message_handle, surface="text")
    history = await _load_history(sender) if sender else []
    try:
        res = await agent_run_with_retry(
            assistant_agent, prompt, deps=deps,
            message_history=history if history else None,
        )
        if sender:
            await _save_history(sender, res.all_messages())
        return {"reply": res.output}
    except Exception as e:
        if llm._is_rate_limit_error(e):
            return {"reply": RATE_LIMIT_REPLY}
        if sender and llm.is_broken_history_error(e) and history:
            print("broken conversation history detected — clearing cache and retrying clean:", e)
            await cache.cache_delete(_convo_key(sender))
            try:
                res = await agent_run_with_retry(assistant_agent, prompt, deps=deps)
                if sender:
                    await _save_history(sender, res.all_messages())
                return {"reply": res.output}
            except Exception as e2:
                if llm._is_rate_limit_error(e2):
                    return {"reply": RATE_LIMIT_REPLY}
                raise
        raise


def _messages_to_history(messages: list[dict]) -> list:
    """Convert the client-owned [{"role": "user"|"assistant", "content": str}, ...] array
    into pydantic-ai message history. This is plain role/content pairs from the website,
    not pydantic-ai's wire format, so it can't go through ModelMessagesTypeAdapter like
    the phone-keyed cache in _load_history does."""
    history = []
    for m in messages or []:
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if m.get("role") == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        elif m.get("role") == "assistant":
            history.append(ModelResponse(parts=[TextPart(content=content)]))
    return history


# keep in sync with src/lib/chatTypes.ts ChatSSEEvent
# Vercel's api/chat.py maxDuration is 300s — if a run is still going near that,
# Vercel hard-kills the connection with no event ever reaching the client, which is
# why chat sometimes looked like it "just stopped." This soft deadline sits under
# that hard limit so a run that's about to get killed instead yields a clean error
# event first.
_WEB_CHAT_SOFT_DEADLINE_SECONDS = 270.0

_WEB_CHAT_TIMEOUT_MESSAGE = "this is taking longer than expected - try a narrower ask or break it into steps"


async def run_web_chat_stream(messages: list[dict], should_stop=None):
    """Dashboard chat entry point — a separate surface from the iMessage thread with no
    shared memory. The client owns the full conversation: history is reconstructed
    fresh from the messages array on every call (instead of the phone-keyed cache in
    cache.py). assistant_agent itself is a module-level singleton (see above) — no
    per-request state to isolate beyond the AgentDeps built here. Runs behind
    api/chat.py on Vercel, yielding structured events (text deltas + tool-call trace)
    as they happen instead of collecting one final reply string.

    Retries on 429 only cover opening the run and pulling the first node, i.e. before
    any event has been yielded to the caller. Once a byte has gone out over the wire,
    a failure becomes a terminal {"type": "error"} event rather than a silent retry —
    tools like save_startups have side effects, so replaying a partially-streamed turn
    risks calling them twice.

    should_stop: optional zero-arg async callable, checked at the same checkpoints as
    the soft deadline — the caller's connection-dropped signal (api/chat.py passes
    Starlette's request.is_disconnected). Without this, aborting the client-side fetch
    (the web UI's Stop button, or just navigating away) only stopped the client from
    reading further events; the agent kept running server-side to completion,
    including any tool calls still queued (save_startups, schedule_agent_run, ...)
    with nobody left to see the result. This can't cancel a tool call already
    in-flight when the disconnect is noticed, but it does stop the run from starting
    another model turn or tool call after that point.
    """
    if not messages or messages[-1].get("role") != "user":
        return

    history = _messages_to_history(messages[:-1])
    prompt = messages[-1].get("content", "")
    deps = _default_deps(sender=None, message_handle=None, surface="web")

    max_attempts = 8
    attempt = 0
    started = False  # True once any event has been yielded to the caller — past
    # this point a 429 can no longer be silently retried without risking duplicate
    # tool side effects (e.g. save_startups), so it must surface as a terminal error.
    deadline = asyncio.get_event_loop().time() + _WEB_CHAT_SOFT_DEADLINE_SECONDS

    def _past_deadline() -> bool:
        return asyncio.get_event_loop().time() > deadline

    async def _client_gone() -> bool:
        if should_stop is None:
            return False
        try:
            return bool(await should_stop())
        except Exception:
            return False

    while True:
        try:
            async with assistant_agent.iter(
                prompt,
                deps=deps,
                message_history=history if history else None,
                usage_limits=_USAGE_LIMITS,
            ) as agent_run:
                async for node in agent_run:
                    if _past_deadline():
                        yield {"type": "error", "message": _WEB_CHAT_TIMEOUT_MESSAGE, "retryable": True}
                        return
                    if await _client_gone():
                        return
                    if Agent.is_model_request_node(node):
                        async with node.stream(agent_run.ctx) as request_stream:
                            async for text in request_stream.stream_text(delta=True):
                                started = True
                                yield {"type": "text_delta", "text": text}
                                if _past_deadline():
                                    yield {"type": "error", "message": _WEB_CHAT_TIMEOUT_MESSAGE, "retryable": True}
                                    return
                                if await _client_gone():
                                    return
                    elif Agent.is_call_tools_node(node):
                        async with node.stream(agent_run.ctx) as handle_stream:
                            async for event in handle_stream:
                                if isinstance(event, FunctionToolCallEvent):
                                    started = True
                                    yield {
                                        "type": "tool_call",
                                        "tool_call_id": event.part.tool_call_id,
                                        "tool_name": event.part.tool_name,
                                        "args": event.part.args_as_dict()
                                        if hasattr(event.part, "args_as_dict")
                                        else event.part.args,
                                    }
                                elif isinstance(event, FunctionToolResultEvent):
                                    started = True
                                    yield {
                                        "type": "tool_result",
                                        "tool_call_id": event.tool_call_id,
                                        "result": str(event.part.content),
                                    }
                                if _past_deadline():
                                    yield {"type": "error", "message": _WEB_CHAT_TIMEOUT_MESSAGE, "retryable": True}
                                    return
                                if await _client_gone():
                                    return
            break
        except Exception as e:
            if not started and llm._is_transient_error(e) and attempt < max_attempts - 1:
                delay = 3 * (2 ** attempt)
                attempt += 1
                await asyncio.sleep(delay)
                continue
            if llm._is_rate_limit_error(e):
                yield {"type": "error", "message": RATE_LIMIT_REPLY, "retryable": not started}
                return
            if llm._is_transient_error(e):
                yield {
                    "type": "error",
                    "message": "having trouble reaching the model - try again in a bit",
                    "retryable": not started,
                }
                return
            yield {"type": "error", "message": str(e), "retryable": False}
            return

    yield {"type": "done"}


async def run_feedback(slug: str, name: str, status: str, message: str) -> dict:
    feedback = (message or "").strip()
    if not feedback:
        return {"error": "feedback required"}

    if status not in ("new", "approved", "passed"):
        status = "new"

    prompt = (
        f"Dashboard feedback for {name} (slug: {slug}).\n"
        f"Dashboard status: {status}\n"
        f"User feedback: {feedback}\n\n"
        "Distill this into memory. Call the required tools before you reply."
    )

    try:
        res = await agent_run_with_retry(feedback_agent, prompt)
        return {"ok": True, "reply": res.output}
    except Exception as e:
        if llm._is_rate_limit_error(e):
            return {"error": RATE_LIMIT_REPLY}
        raise


async def run_scheduled_agent_run(instructions: str, sender: str | None = None) -> dict:
    """Fired when a schedule_agent_run task comes due (agent_followup, or the legacy
    text_followup kind). Runs the exact same assistant_agent, with the saved
    instructions as the prompt — this is what "the agent wakes itself up and acts
    autonomously" actually looks like: no separate scheduled-run architecture, just
    another call into the one pipeline. surface follows whether a phone was attached
    at schedule time: with a sender, the reply reads like a text and gets SMS'd back
    (unchanged behavior for boss-initiated follow-ups); without one, the reply lands
    on the dashboard's Scheduled Runs page, which is the only place it surfaces.
    background=True regardless of surface — see AgentDeps/prompts.build_instructions
    for why: that page renders the reply as plain preformatted text, not a chat UI,
    so the reply must be a short plain-text outcome report either way, never
    generative UI or rich Markdown."""
    instructions = (instructions or "").strip()
    if not instructions:
        return {"reply": ""}

    surface: Literal["text", "web"] = "text" if sender else "web"
    deps = _default_deps(sender=sender, message_handle=None, surface=surface, background=True)
    prompt = (
        f"This is a scheduled self-run you set up earlier. Your instructions were: "
        f"'{instructions}'. Carry them out now and report back."
    )

    try:
        res = await agent_run_with_retry(assistant_agent, prompt, deps=deps)
        return {"reply": res.output}
    except Exception as e:
        if llm._is_rate_limit_error(e):
            return {"reply": ""}
        raise


async def run_agent(payload: dict) -> dict:
    mode = payload.get("mode", "text")

    if mode == "feedback":
        return await run_feedback(
            payload.get("slug", ""),
            payload.get("name", ""),
            payload.get("status", "new"),
            payload.get("message", ""),
        )
    elif mode == "text":
        return await run_text_handler(
            payload.get("message"),
            payload.get("slug"),
            payload.get("sender"),
            payload.get("message_handle"),
        )
    elif mode == "scheduled_run":
        return await run_scheduled_agent_run(
            payload.get("instructions", ""),
            payload.get("sender"),
        )
    elif mode == "append_alert":
        return await append_alert_to_history(
            payload.get("message", ""),
            payload.get("recipients", []),
        )

    return {"error": "unknown mode"}
