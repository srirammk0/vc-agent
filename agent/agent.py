import os
import json
import asyncio
from dataclasses import dataclass
import threading
import time
import urllib.request
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext, ToolDefinition
from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelResponse, TextPart
from pydantic_ai.usage import UsageLimits

from tools.exa import exa
from tools import linkup
import memory_store as sm
import cache
import llm
from news_digest import (
    NEWS_DIGEST_RULES,
    DIGEST_LINKUP_SEARCHES,
    monitored_sources_text,
)

_EXA_DEEP_TTL_SECONDS = 6 * 3600
_USAGE_LIMITS = UsageLimits(request_limit=40)

model = llm.model

RATE_LIMIT_REPLY = (
    "models are getting hammered rn - give it a min and text again"
)

_CONVO_TTL_SECONDS = 24 * 3600
_CONVO_MAX_MESSAGES = 20  # ~10 back-and-forth turns, pure rolling window — no summarization


def _convo_key(sender: str) -> str:
    digits = "".join(c for c in sender if c.isdigit())
    return f"conv:{digits}"


async def _load_history(sender: str) -> list:
    try:
        data = await cache.cache_get(_convo_key(sender), _CONVO_TTL_SECONDS)
        if data:
            return ModelMessagesTypeAdapter.validate_python(data)
    except Exception as e:
        print("failed to load conversation history:", e)
    return []


async def _save_history(sender: str, messages: list) -> None:
    try:
        trimmed = messages[-_CONVO_MAX_MESSAGES:]
        data = ModelMessagesTypeAdapter.dump_python(trimmed, mode="json")
        await cache.cache_set(_convo_key(sender), data)
    except Exception as e:
        print("failed to save conversation history:", e)


async def append_alert_to_history(message: str, recipients: list[str]) -> dict:
    """Append a scheduled-job alert (e.g. the scout sweep SMS) to a recipient's
    conversation history as if the text_agent had just said it, so a follow-up
    text from the boss has that context without re-fetching it from Supermemory."""
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


class StartupSave(BaseModel):
    slug: str
    name: str
    website: str = ""
    one_liner: str
    assessment: str
    signal_urls: list[str] = Field(default_factory=list)


class StatusUpdate(BaseModel):
    slug: str
    status: str
    reason: str = ""


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


@dataclass
class AgentDeps:
    phone_number: str
    from_number: str
    sb_key: str
    sb_secret: str
    message_handle: str = None
    typing_thread: threading.Thread = None
    stop_typing: threading.Event = None


from pydantic_ai.capabilities import Hooks

hooks = Hooks()


STYLE_RULES = """Style rules:
- Be super informal, friendly, and casual.
- Write in lowercase (no capital letters unless needed).
- Keep it very concise (iMessage style).
- Use natural texting talk/slang, but not overly done. Sound like a human, not an AI.
- Do NOT use emojis at all.
- Do NOT say "hey" or "hi" or greet the user. Assume this is a continuation of an ongoing chat (no greetings).
- Do NOT use em dashes (—). Use hyphens (-) or standard punctuation.
- Use exactly 1 line of whitespace (one empty line) to separate things for easy readability."""

CORE_RULES = """You are a sharp, autonomous research analyst for a pre-seed VC fund. Your boss texts you to manage startup dealflow and do deep research.

Memory: Supermemory is your only long-term store. Never reference Supabase or ask the boss to do anything there.

Tool routing — follow this exactly:
- Startup discovery or deep research → exa_deep_search_many (ALWAYS a list, even one query)
- News, press checks, fund blogs, facts → linkup_search or linkup_search_many
- Fetch a known URL → linkup_fetch
- Look up something you already know → supermemory_search (FIRST before any web search)
- Status change (approve/pass) → update_startup_statuses. If you don't have the slug, call list_known_startups FIRST to find it.
- Save new startups → save_startups (batch). Skip anything with significant existing press coverage — use your own judgment based on what you found in research.
- Permanently remove a startup (duplicate, mistake, bad data) → delete_startups. If you don't have the slug, call list_known_startups FIRST. Do NOT use this for a startup the boss is just rejecting — that's update_startup_statuses with 'passed'.
- Learn a pattern → write_preferences; record a reflection → write_reflection
- Wrong or outdated learned pattern → list_preferences to find its ID, then delete_preferences

Batch-only tools — non-negotiable, pass a list even for a single item:
- save_startups, update_startup_statuses, delete_startups, write_preferences, delete_preferences, exa_deep_search_many

Self-healing — non-negotiable:
- Tool result starting with "[" = error. Do NOT retry with the same args. Change params or skip.
- 3 consecutive tool errors → stop, tell the boss what failed.
- Never call the same tool with identical arguments twice in one run.

Task discipline — non-negotiable:
- Complete the full task before replying. No half-done work, no "I'll do this next."
- Batch everything: one call to save_startups, one call to update_startup_statuses, one call to exa_deep_search_many.
- All tool calls FIRST, then your final text reply. Never reply before the tools are done."""


text_agent = Agent(
    model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES,
    model_settings=llm.FINALIZE_SMS_SETTINGS,
)

scout_agent = Agent(
    model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES,
    model_settings=llm.FINALIZE_SCOUT_SETTINGS,
)

news_agent = Agent(
    model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + NEWS_DIGEST_RULES,
    model_settings=llm.FINALIZE_NEWS_SETTINGS,
)

FEEDBACK_RULES = """You process dashboard feedback for a VC scout's dealflow.

Your job:
- Distill the user's reason into a concise, reusable learning pattern.
- Save it with write_preferences (one-element list). type must be "approved" (seek) for approve reasons, "passed" (avoid) for pass reasons.
- If the dashboard status is approved or passed, call update_startup_statuses with the slug, that status, and reason set to your distilled one-liner.
- If status is new, only call write_preferences unless they clearly want a status change.

Rules:
- Never touch Supabase. Supermemory only.
- Do not call search tools or update_thesis.
- Finish all tool calls before replying.
- Reply with one short lowercase confirmation of what you saved."""

feedback_agent = Agent(
    llm.fast_model,
    system_prompt=FEEDBACK_RULES,
    model_settings=llm.FINALIZE_FEEDBACK_SETTINGS,
)


@hooks.on.before_run
def start_typing_indicator(ctx: RunContext[AgentDeps]):
    _start_typing(ctx.deps)


@hooks.on.after_run
def stop_typing_indicator(ctx: RunContext[AgentDeps], *, result):
    _stop_typing(ctx.deps)
    return result


@hooks.on.run_error
def stop_typing_on_error(ctx: RunContext[AgentDeps], *, error):
    _stop_typing(ctx.deps)
    raise error


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


def _stop_typing(deps: AgentDeps | None) -> None:
    if not deps:
        return
    if deps.stop_typing:
        deps.stop_typing.set()
    if deps.typing_thread:
        deps.typing_thread.join()
        deps.typing_thread = None


def _start_typing(deps: AgentDeps | None) -> None:
    if not deps or not deps.phone_number or not deps.sb_key or not deps.sb_secret:
        return
    if deps.typing_thread and deps.typing_thread.is_alive():
        return

    deps.stop_typing = threading.Event()
    headers = {
        "sb-api-key-id": deps.sb_key,
        "sb-api-secret-key": deps.sb_secret,
        "Content-Type": "application/json",
    }
    recipient = deps.phone_number
    sender = deps.from_number

    def typing_loop():
        while not deps.stop_typing.is_set():
            try:
                urllib.request.urlopen(urllib.request.Request(
                    "https://api.sendblue.co/api/send-typing-indicator",
                    data=json.dumps({
                        "number": recipient,
                        "from_number": sender,
                        "state": "start",
                        "max_duration_ms": 60000,
                    }).encode("utf-8"),
                    headers=headers,
                    method="POST",
                ))
            except Exception as e:
                print("typing indicator failed:", e)
            for _ in range(30):
                if deps.stop_typing.is_set():
                    break
                time.sleep(0.1)

    deps.typing_thread = threading.Thread(target=typing_loop, daemon=True)
    deps.typing_thread.start()


@text_agent.system_prompt
async def text_handler_prompt(ctx: RunContext) -> str:
    thesis = await sm.load_thesis()
    preferences = await sm.load_preferences()
    known = await sm.known_startups_summary()
    scout_notes = await sm.load_recent_reflection("scout")
    market_brief = await sm.load_latest_market_brief()
    return f"""You handle inbound texts from your boss (a pre-seed VC) and execute their requests fully before replying.

Standing rule — always save what you find: any time your research (exa_deep_search_many, supermemory_search,
etc.) surfaces a genuine early-stage startup that isn't already in your known list below and it fits the
thesis, call save_startups for it — even if the boss only asked a casual question like "what do you think
of X" rather than explicitly requesting a sweep. Don't just describe a candidate in your reply and let it
evaporate; if it's worth mentioning, it's worth saving.

Other autonomous processes you run alongside — context only, you do not re-run these:

Latest scout sweep notes (from the autonomous scouting agent, runs every 4h):
{scout_notes}

Latest weekly market-intel brief (from the news digest agent, runs Monday mornings):
{market_brief}

Common requests and exactly how to handle them:

"what did the scout find" / "what's new from scouting" / "what was in this week's brief" / "what's been happening"
→ answer directly from the scout sweep notes / market brief above, no tool call needed
→ only call supermemory_search (container_tag vc:reflections or vc:market-intel) if the boss wants more detail than what's summarized above

"approve X" / "pass on X" / "mark X as [status]"
→ call list_known_startups if you don't already have the slug
→ call update_startup_statuses([{{slug, status, reason}}])
→ call write_preferences([{{pattern, type}}]) with the distilled reason
→ reply confirming what changed

"delete X" / "remove X" / "forget about X" / "that was a duplicate/mistake"
→ call list_known_startups if you don't already have the slug
→ call delete_startups([slug])
→ reply confirming it's gone
→ do NOT use this for a startup the boss is just rejecting — use update_startup_statuses with 'passed' instead

"that pattern/preference is wrong" / "stop avoiding X" / "we don't care about that anymore"
→ call list_preferences to find the matching ID
→ call delete_preferences([id])
→ reply confirming what was removed

"find me startups" / "run a sweep" / "scout for X"
→ call exa_deep_search_many with 4-5 diverse queries in ONE call
→ skip anything already in the known list below or with obvious major press coverage
→ call save_startups in ONE batch call for all survivors
→ reply with what you found and saved

"what do you know about X" / "tell me about X"
→ call supermemory_search FIRST (vc:startups container)
→ if memory has useful info, reply from that
→ only call exa_deep_search_many if memory has nothing

"what's happening in AI / VC" / news questions
→ call linkup_search or linkup_search_many

"change our thesis to..." / "update criteria"
→ call update_thesis with the full new content

Startups you already know (name | slug | status) — never re-save these:
{known}

Investment thesis:
{thesis}

Patterns you've learned (seek/avoid):
{preferences}

{STYLE_RULES}
"""


@scout_agent.system_prompt
async def scout_prompt(ctx: RunContext) -> str:
    thesis = await sm.load_thesis()
    preferences = await sm.load_preferences()
    return f"""You are running an autonomous scouting sweep for pre-seed AI startups. You have the exact
same research tools and abilities as the SMS agent handling "find me startups" / "run a sweep"
requests from the boss — search decisively, don't second-guess yourself across multiple passes.

1. Search broadly — exa_deep_search_many with 5+ diverse queries in ONE call.
2. Skip anything that fails the thesis hard filters, or that already has obvious major press coverage
   (a passing mention is fine, a funding round announcement is not) — use your judgment, don't over-filter.
3. Save every survivor — call save_startups ONCE in a single batch with a qualitative assessment for each.
   Do not reply until save_startups has been called.

Investment thesis (hard filters — non-negotiable):
{thesis}

Patterns you've learned (seek / avoid):
{preferences}

{STYLE_RULES}
"""


@news_agent.system_prompt
async def news_digest_prompt(ctx: RunContext) -> str:
    thesis = await sm.load_thesis()
    preferences = await sm.load_preferences()
    return f"""You are running the weekly VC market-intel brief (Monday morning).

Cover all three buckets in your research:
1. VC/industry news (funding rounds, sector trends, market moves from the past ~7 days)
2. Top fund blogs (a16z, Sequoia, Benchmark, First Round, NFX, Founders Fund, Greylock, etc.)
3. Individual investors and thinkers (Paul Graham, operator VCs, prominent substacks/newsletters)

Sources you monitor:
{monitored_sources_text()}

Use linkup_search_many with includeDomains for news, fund blogs, and investor writing (NOT exa). Use exa only if Linkup returns nothing useful.

You do NOT have update_thesis — hard filters below are immutable.

Current thesis (hard filters are fixed — do not change):
{thesis}

Existing soft patterns:
{preferences}

{STYLE_RULES}
"""


def make_non_strict(ctx: RunContext, tool_def: ToolDefinition) -> ToolDefinition:
    tool_def.strict = False
    return tool_def


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
                num_results=3,
                contents={
                    "text": {"max_characters": 2000},
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
    market_brief: bool = False,
    exa: bool = True,
    linkup_tools: bool = False,
    reflection_source: str = "scout",
):
    _T = "[tool timed out — skip this step and continue]"

    def _err(e: Exception) -> str:
        return f"[tool error: {type(e).__name__}: {e} — try different params or skip]"

    if exa:

        @agent.tool(prepare=make_non_strict)
        async def exa_deep_search_many(ctx: RunContext, queries: list[str]) -> str:
            """Run Exa searches in parallel for startup discovery and deep research. Use even for a single query — pass a one-element list."""
            if not queries:
                return "No queries provided."
            try:
                parts = await asyncio.gather(*[_exa_deep_search_one(q) for q in queries])
                return "\n\n".join(
                    f"=== Query: {query} ===\n{result}" for query, result in zip(queries, parts)
                )
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

        @agent.tool(prepare=make_non_strict)
        async def linkup_search_many(
            ctx: RunContext,
            queries: list[LinkupSearchQuery],
            from_date: str = "",
        ) -> str:
            """Run multiple Linkup searches in parallel. Use for news digest buckets with include_domains."""
            try:
                specs = [q.model_dump() for q in queries]
                default_from = from_date or linkup.week_ago_date()
                return await linkup.search_many(specs, default_from_date=default_from)
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
    async def supermemory_search(ctx: RunContext, query: str, container_tag: str = "vc:startups") -> str:
        """Search the agent's own memory semantically. container_tag: vc:thesis, vc:preferences, vc:startups, vc:reflections, vc:market-intel."""
        try:
            return await sm.semantic_search(query, container_tag)
        except asyncio.TimeoutError:
            return _T
        except Exception as e:
            return _err(e)

    if dealflow:

        @agent.tool(prepare=make_non_strict)
        async def list_known_startups(ctx: RunContext) -> str:
            """List every startup in memory with name, slug, and status. Call this before update_startup_statuses if you don't have the exact slug, and before any scout sweep to avoid duplicates."""
            try:
                return await sm.known_startups_summary()
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def save_startups(ctx: RunContext, startups: list[StartupSave]) -> str:
            """Save new startups to memory. slug must be a lowercase hyphenated identifier (e.g. 'acme-ai'). Use even for one startup — pass a one-element list."""
            if not startups:
                return "No startups provided."
            try:
                items = [s.model_dump() for s in startups]
                saved, errors = await sm.save_startups_batch(items)
                lines = [f"Saved {len(saved)} startup(s): {', '.join(saved) or 'none'}"]
                if errors:
                    lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
                return "\n".join(lines)
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def update_startup_statuses(ctx: RunContext, updates: list[StatusUpdate]) -> str:
            """Approve or pass startups. status: 'approved', 'passed', or 'new'. IMPORTANT: slug must be exact — call list_known_startups first if you're not 100% sure of the slug. Use even for one startup — pass a one-element list."""
            if not updates:
                return "No updates provided."
            try:
                items = [u.model_dump() for u in updates]
                updated, errors = await sm.update_startup_statuses_batch(items)
                lines = [f"Updated {len(updated)} startup(s): {', '.join(updated) or 'none'}"]
                if errors:
                    lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
                return "\n".join(lines)
            except asyncio.TimeoutError:
                return _T
            except Exception as e:
                return _err(e)

        @agent.tool(prepare=make_non_strict)
        async def delete_startups(ctx: RunContext, slugs: list[str]) -> str:
            """Permanently delete startups from memory (and the dashboard). Use for duplicates, mistakes, or bad saves — not for rejecting a startup (use update_startup_statuses with 'passed' for that). IMPORTANT: slug must be exact — call list_known_startups first if unsure. Use even for one startup — pass a one-element list."""
            if not slugs:
                return "No slugs provided."
            try:
                deleted, errors = await sm.delete_startups_batch(slugs)
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
        """Write a post-run self-improvement note about how the sweep went and what to do differently."""
        try:
            await sm.write_reflection(reflection, source=reflection_source)
            return "Saved reflection."
        except asyncio.TimeoutError:
            return _T
        except Exception as e:
            return _err(e)

    if market_brief:

        @agent.tool(prepare=make_non_strict)
        async def write_market_brief(ctx: RunContext, brief: str, headline: str = "") -> str:
            """Save this week's structured VC market-intel digest to memory. Include full URLs for every cited article."""
            try:
                date = await sm.write_market_brief(brief, headline)
                return f"Saved market brief for {date}."
            except asyncio.TimeoutError:
                return _T
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
            """Send an iMessage tapback reaction. Valid: 'love', 'like', 'dislike', 'laugh', 'emphasize', 'question'."""
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


register_tools(text_agent, linkup_tools=True, reflection_source="text")
register_tools(scout_agent, linkup_tools=True, reflection_source="scout")
register_tools(
    news_agent,
    dealflow=False,
    thesis_update=False,
    tapback=False,
    market_brief=True,
    exa=False,
    linkup_tools=True,
    reflection_source="news",
)
register_tools(
    feedback_agent,
    dealflow=True,
    thesis_update=False,
    tapback=False,
    market_brief=False,
    exa=False,
    linkup_tools=False,
    reflection_source="feedback",
)


# --- MAIN LOGIC ENTRANCES ---

def _default_deps(sender: str = None, message_handle: str = None) -> AgentDeps:
    recipient = _e164(sender) or _e164(os.environ.get("ALERT_PHONE_NUMBER", "")) or ""
    return AgentDeps(
        phone_number=recipient,
        from_number=_e164(os.environ.get("SENDBLUE_FROM_NUMBER", "")) or "",
        sb_key=os.environ.get("SENDBLUE_API_KEY", ""),
        sb_secret=os.environ.get("SENDBLUE_API_SECRET", ""),
        message_handle=message_handle,
    )


async def run_scout() -> dict:
    try:
        thesis = await sm.load_thesis()
        preferences = await sm.load_preferences()
        known = await sm.known_startups_summary()
        deps = _default_deps(sender="system")

        r1 = await agent_run_with_retry(
            scout_agent,
            f"Execute a scout sweep. Use exa_deep_search_many with 5+ diverse queries in ONE call to find pre-seed AI startups. "
            f"Skip anything with obvious major press coverage or that fails the thesis hard filters. "
            f"Call save_startups in ONE batch call for every survivor, with a qualitative assessment for each. "
            f"Do not reply until save_startups has been called.\n\n"
            f"Thesis:\n{thesis}\n\nRemember these patterns:\n{preferences}\n\nYou ALREADY KNOW these startups - do NOT research or save them again, find NEW ones:\n{known}",
            deps=deps,
        )

        r2 = await agent_run_with_retry(
            scout_agent,
            "What patterns did you notice this sweep? Call write_preferences with all new patterns and write_reflection with your sweep notes. Do not reply until both tools have been called.",
            message_history=r1.all_messages(),
            deps=deps,
        )

        return {"reply": r2.output}
    except Exception as e:
        if llm._is_rate_limit_error(e):
            return {"reply": RATE_LIMIT_REPLY}
        raise


async def run_news_digest() -> dict:
    try:
        deps = _default_deps(sender="system")
        from_date = linkup.week_ago_date()
        search_specs = "\n".join(
            f"- {s['q']} | domains: {s.get('include_domains') or 'any'}"
            for s in DIGEST_LINKUP_SEARCHES
        )

        r1 = await agent_run_with_retry(
            news_agent,
            f"Run this week's market-intel research. Call linkup_search_many ONCE with from_date={from_date} "
            f"and these searches (pass each as a LinkupSearchQuery with q, include_domains, depth):\n"
            f"{search_specs}\n\n"
            "Cover all three buckets: VC news, fund blogs, individual investors.",
            deps=deps,
        )

        r2 = await agent_run_with_retry(
            news_agent,
            "Reflect on what you read. What themes matter for our pre-seed AI sourcing? "
            "What should we seek or avoid in SOFT scoring (not hard filters)? "
            "How can we find better picks this week? Do not save yet.",
            message_history=r1.all_messages(),
            deps=deps,
        )

        r3 = await agent_run_with_retry(
            news_agent,
            "Write up this week's brief with three sections (VC news, Fund blogs, Individual investors). "
            "For every item you mention, include the source URL from your Linkup results (title — https://...). "
            "Then call write_market_brief with the full linked digest, write_preferences for any new "
            "seek/avoid patterns (soft only), and write_reflection with your meta notes. "
            "Your final reply must list the top 5-8 most important links (full URLs, one per line) "
            "plus a 2-3 sentence takeaway for scouting. Do NOT call update_thesis. "
            "Do not reply until all three tools have been called.",
            message_history=r2.all_messages(),
            deps=deps,
        )

        return {"reply": r3.output}
    except Exception as e:
        if llm._is_rate_limit_error(e):
            return {"reply": RATE_LIMIT_REPLY}
        raise


async def run_text_handler(message: str, slug: str = None, sender: str = None, message_handle: str = None) -> dict:
    prompt = f"The boss sent this message: '{message}'. Handle it."
    if slug:
        prompt += f" Context startup slug: {slug}."

    deps = _default_deps(sender=sender, message_handle=message_handle)
    history = await _load_history(sender) if sender else []
    try:
        res = await agent_run_with_retry(
            text_agent, prompt, deps=deps,
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
                res = await agent_run_with_retry(text_agent, prompt, deps=deps)
                if sender:
                    await _save_history(sender, res.all_messages())
                return {"reply": res.output}
            except Exception as e2:
                if llm._is_rate_limit_error(e2):
                    return {"reply": RATE_LIMIT_REPLY}
                raise
        raise


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


async def run_agent(payload: dict) -> dict:
    mode = payload.get("mode", "text")

    if mode == "scout":
        return await run_scout()
    elif mode == "news_digest":
        return await run_news_digest()
    elif mode == "feedback":
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
    elif mode == "append_alert":
        return await append_alert_to_history(
            payload.get("message", ""),
            payload.get("recipients", []),
        )

    return {"error": "unknown mode"}
