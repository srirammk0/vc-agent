import os
import json
import asyncio
from dataclasses import dataclass
import threading
import time
import urllib.request
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext, ToolDefinition
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

# Scout queries vary a lot, so keep a short reuse window; page content itself
# is served from Exa's crawl cache via max_age_hours.
_EXA_DEEP_TTL_SECONDS = 6 * 3600
_USAGE_LIMITS = UsageLimits(request_limit=100)

model = llm.model

RATE_LIMIT_REPLY = (
    "models are getting hammered rn - give it a min and text again"
)


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

CORE_RULES = """You are a smart, fully autonomous research analyst for a VC. Your boss texts you to manage startup dealflow and do deep research.

Critical rules:
- Never touch Supabase. Your only memory system is Supermemory. Read and write everything through your memory tools.
- You are self-improving. After every scout sweep you must write patterns (write_preference) and reflections (write_reflection).
- Make qualitative, evidence-backed judgments about startups. There is no numeric scoring; write a clear assessment instead.
- Use exa_deep_search / exa_deep_search_many for startup discovery and deep research on specific companies.
- Use linkup_search / linkup_search_many for VC news, fund blogs, press checks, and quick factual lookups.
- Use linkup_fetch when you already have a URL and need the full page markdown.
- Use check_press_coverage before saving a startup — hard filter requires NO recent major press.
- Never re-research a startup you already know. Before deep-diving a candidate, check the known-startups list and skip any you've already saved, unless the boss explicitly asks you to revisit it. Spend your time finding NEW companies.

Task completion (non-negotiable):
- Finish the full task before you reply. If the boss asks for N startups, research and save N new genuine finds (or clearly explain why fewer exist).
- Never stop partway, never say "more are on the way", and never tease unfinished work in your reply.
- When handling multiple items, use batch tools in one call: save_startups, exa_deep_search_many, update_startup_statuses, write_preferences.
- Do all required tool calls first, then send your final text reply."""


text_agent = Agent(
    model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES,
)

scout_agent = Agent(
    model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES,
)

news_agent = Agent(
    model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + NEWS_DIGEST_RULES,
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
    known = await sm.known_startups_brief()
    return f"""You process inbound texts from the boss for the VC workflow.

You have tools to search the web (exa_deep_search, exa_deep_search_many for discovery; linkup_search, linkup_search_many, linkup_fetch for news/facts/press), recall your memory (supermemory_search), save startups (save_startup, save_startups), approve/pass them (update_startup_status, update_startup_statuses), check press (check_press_coverage, check_press_coverage_many), record learnings (write_preference, write_preferences, write_reflection), and update the thesis (update_thesis). You can also react to texts using send_tapback_reaction.

Search routing: startup discovery → Exa. News, press checks, quick facts → Linkup.

Prefer batch tools whenever you have multiple searches, saves, status changes, or preferences to write.

If asked to "find new startups" or run a "scout sweep", search broadly, reflect on what holds up against the thesis, do targeted follow-up research, and save ALL genuine finds with save_startups in one call before replying. Skip any startup already in the known list below unless the boss explicitly asks you to revisit it.

To approve or pass startups, use update_startup_statuses when changing more than one. If the boss wants to change investment criteria, use update_thesis.

Startups you already know (name + website):
{known}

Your core thesis is:
{thesis}

Patterns you've learned (seek/avoid):
{preferences}

{STYLE_RULES}
"""


@scout_agent.system_prompt
async def scout_prompt(ctx: RunContext) -> str:
    return f"""You are running an autonomous scouting sweep for pre-seed AI startups.

Work through the sweep in disciplined turns: search broadly, reflect critically, do targeted deep research to confirm a thesis, then save ALL genuine finds with save_startups (one batch call) and record your learnings. Be specific about the signals that make a startup interesting or not. Do not finish a turn until the work for that turn is fully done.

{STYLE_RULES}
"""


@news_agent.system_prompt
async def news_digest_prompt(ctx: RunContext) -> str:
    thesis = await sm.load_thesis()
    preferences = await sm.load_preferences()
    return f"""You are running the daily 6am VC market-intel brief.

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
        res = await asyncio.to_thread(
            exa.search,
            query,
            num_results=3,
            contents={
                "text": {"max_characters": 2000},
                "max_age_hours": 168,
            },
        )
        results = []
        for r in getattr(res, "results", []):
            content = r.text if hasattr(r, "text") and r.text else "No content"
            results.append(f"Title: {r.title}\nURL: {r.url}\nContent: {content}\n---")
        output = "\n".join(results) if results else "No results found."
    except Exception as e:
        return f"Exa search failed: {e}"

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
):
    if exa:

        @agent.tool(prepare=make_non_strict)
        async def exa_deep_search(ctx: RunContext, query: str) -> str:
            """Search the web for one query and return deep text content of the top results. Use for startup discovery and deep company research."""
            return await _exa_deep_search_one(query)

        @agent.tool(prepare=make_non_strict)
        async def exa_deep_search_many(ctx: RunContext, queries: list[str]) -> str:
            """Run multiple Exa searches in parallel. Use for obscure startup discovery, not news."""
            if not queries:
                return "No queries provided."
            parts = await asyncio.gather(*[_exa_deep_search_one(q) for q in queries])
            return "\n\n".join(
                f"=== Query: {query} ===\n{result}" for query, result in zip(queries, parts)
            )

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
            return await linkup.search(
                q,
                depth=depth,
                include_domains=include_domains or None,
                from_date=from_date or None,
            )

        @agent.tool(prepare=make_non_strict)
        async def linkup_search_many(
            ctx: RunContext,
            queries: list[LinkupSearchQuery],
            from_date: str = "",
        ) -> str:
            """Run multiple Linkup searches in parallel. Use for news digest buckets with include_domains."""
            specs = [q.model_dump() for q in queries]
            default_from = from_date or linkup.week_ago_date()
            return await linkup.search_many(specs, default_from_date=default_from)

        @agent.tool(prepare=make_non_strict)
        async def linkup_fetch(ctx: RunContext, url: str) -> str:
            """Fetch full page markdown from a URL when you already know the link."""
            return await linkup.fetch(url, render_js=True)

        @agent.tool(prepare=make_non_strict)
        async def check_press_coverage(ctx: RunContext, startup_name: str) -> str:
            """Check if a startup has press on major outlets. Hard filter: must have NO recent press to save."""
            return await linkup.check_press_coverage(startup_name)

        @agent.tool(prepare=make_non_strict)
        async def check_press_coverage_many(ctx: RunContext, startup_names: list[str]) -> str:
            """Check press coverage for multiple startups in parallel before saving."""
            return await linkup.check_press_coverage_many(startup_names)

    @agent.tool(prepare=make_non_strict)
    async def supermemory_search(ctx: RunContext, query: str, container_tag: str = "vc:startups") -> str:
        """Search the agent's own memory semantically. container_tag is one of: vc:thesis, vc:preferences, vc:startups, vc:reflections, vc:market-intel."""
        return await sm.semantic_search(query, container_tag)

    if dealflow:

        @agent.tool(prepare=make_non_strict)
        async def list_known_startups(ctx: RunContext) -> str:
            """List every startup already saved in memory (name, slug, status). Use this to avoid re-researching companies you've already covered."""
            return await sm.known_startups_summary()

        @agent.tool(prepare=make_non_strict)
        async def save_startup(
            ctx: RunContext,
            slug: str,
            name: str,
            website: str,
            one_liner: str,
            assessment: str,
            signal_urls: list[str],
        ) -> str:
            """Save a single startup. Prefer save_startups when saving multiple."""
            saved, errors = await sm.save_startups_batch([{
                "slug": slug,
                "name": name,
                "website": website,
                "one_liner": one_liner,
                "assessment": assessment,
                "signal_urls": signal_urls,
            }])
            if errors:
                return f"Failed to save {slug}: {errors[0]}"
            return f"Saved {name} ({slug}) to memory."

        @agent.tool(prepare=make_non_strict)
        async def save_startups(ctx: RunContext, startups: list[StartupSave]) -> str:
            """Save many startups to memory in parallel. Use this whenever you have more than one startup to save."""
            if not startups:
                return "No startups provided."
            items = [s.model_dump() for s in startups]
            saved, errors = await sm.save_startups_batch(items)
            lines = [f"Saved {len(saved)} startup(s): {', '.join(saved) or 'none'}"]
            if errors:
                lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
            return "\n".join(lines)

        @agent.tool(prepare=make_non_strict)
        async def update_startup_status(ctx: RunContext, slug: str, status: str, reason: str = "") -> str:
            """Update one startup's status. Prefer update_startup_statuses for multiple."""
            updated, errors = await sm.update_startup_statuses_batch([{
                "slug": slug,
                "status": status,
                "reason": reason,
            }])
            if errors:
                return errors[0]
            return f"Updated {slug} to {status}"

        @agent.tool(prepare=make_non_strict)
        async def update_startup_statuses(ctx: RunContext, updates: list[StatusUpdate]) -> str:
            """Approve or pass many startups in parallel. status must be 'approved', 'passed', or 'new'."""
            if not updates:
                return "No updates provided."
            items = [u.model_dump() for u in updates]
            updated, errors = await sm.update_startup_statuses_batch(items)
            lines = [f"Updated {len(updated)} startup(s): {', '.join(updated) or 'none'}"]
            if errors:
                lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
            return "\n".join(lines)

    @agent.tool(prepare=make_non_strict)
    async def write_preference(ctx: RunContext, pattern: str, type: str = "approved") -> str:
        """Save one seek/avoid pattern. Prefer write_preferences for multiple."""
        count, errors = await sm.write_preferences_batch([{"pattern": pattern, "type": type}])
        if errors:
            return f"Failed to save preference: {errors[0]}"
        return f"Saved {type} preference."

    @agent.tool(prepare=make_non_strict)
    async def write_preferences(ctx: RunContext, preferences: list[PreferenceWrite]) -> str:
        """Save many seek/avoid patterns in parallel. type is 'approved' (seek) or 'passed' (avoid)."""
        if not preferences:
            return "No preferences provided."
        items = [p.model_dump() for p in preferences]
        count, errors = await sm.write_preferences_batch(items)
        lines = [f"Saved {count} preference(s)."]
        if errors:
            lines.append(f"Errors ({len(errors)}): {'; '.join(errors)}")
        return "\n".join(lines)

    @agent.tool(prepare=make_non_strict)
    async def write_reflection(ctx: RunContext, reflection: str) -> str:
        """Write a post-run self-improvement note about how the sweep went and what to do differently."""
        await sm.write_reflection(reflection)
        return "Saved reflection."

    if market_brief:

        @agent.tool(prepare=make_non_strict)
        async def write_market_brief(ctx: RunContext, brief: str, headline: str = "") -> str:
            """Save today's structured VC market-intel digest to memory. Include full URLs for every cited article."""
            date = await sm.write_market_brief(brief, headline)
            return f"Saved market brief for {date}."

    if thesis_update:

        @agent.tool(prepare=make_non_strict)
        async def update_thesis(ctx: RunContext, new_content: str) -> str:
            """Update the investment thesis when the boss requests a change in criteria."""
            await sm.update_thesis(new_content)
            return "Updated the investment thesis."

    if tapback:

        @agent.tool(prepare=make_non_strict)
        def send_tapback_reaction(ctx: RunContext[AgentDeps], reaction: str) -> str:
            """Send an iMessage tapback reaction to the user's text.
            Valid reactions are: 'love', 'like', 'dislike', 'laugh', 'emphasize', 'question'.
            """
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


register_tools(text_agent, linkup_tools=True)
register_tools(scout_agent, linkup_tools=True)
register_tools(
    news_agent,
    dealflow=False,
    thesis_update=False,
    tapback=False,
    market_brief=True,
    exa=False,
    linkup_tools=True,
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
            f"Execute a scout sweep. Use exa_deep_search_many with 5+ diverse queries in ONE call to find pre-seed AI startups.\n\nThesis:\n{thesis}\n\nRemember these patterns:\n{preferences}\n\nYou ALREADY KNOW these startups - do NOT research or save them again, find NEW ones:\n{known}",
            deps=deps,
        )

        r2 = await agent_run_with_retry(
            scout_agent,
            "Reflect on what you found. Which candidates are genuinely interesting and why? Which should we skip and why? Be specific about signals. Do not save yet.",
            message_history=r1.all_messages(),
            deps=deps,
        )

        r3 = await agent_run_with_retry(
            scout_agent,
            "For every top candidate: run targeted exa_deep_search_many to confirm your thesis, "
            "then check_press_coverage_many for ALL candidates. Skip any with press hits. "
            "Write a qualitative assessment for each survivor and call save_startups ONCE. "
            "Do not reply until save_startups has been called.",
            message_history=r2.all_messages(),
            deps=deps,
        )

        r4 = await agent_run_with_retry(
            scout_agent,
            "What patterns did you notice this sweep? Call write_preferences with all new patterns and write_reflection with your sweep notes. Do not reply until both tools have been called.",
            message_history=r3.all_messages(),
            deps=deps,
        )

        return {"reply": r4.output}
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
            f"Run today's market-intel research. Call linkup_search_many ONCE with from_date={from_date} "
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
            "Write up today's brief with three sections (VC news, Fund blogs, Individual investors). "
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
    try:
        res = await agent_run_with_retry(text_agent, prompt, deps=deps)
        return {"reply": res.output}
    except Exception as e:
        if llm._is_rate_limit_error(e):
            return {"reply": RATE_LIMIT_REPLY}
        raise


async def run_agent(payload: dict) -> dict:
    mode = payload.get("mode", "text")

    if mode == "scout":
        return await run_scout()
    elif mode == "news_digest":
        return await run_news_digest()
    elif mode == "text":
        return await run_text_handler(
            payload.get("message"),
            payload.get("slug"),
            payload.get("sender"),
            payload.get("message_handle"),
        )

    return {"error": "unknown mode"}
