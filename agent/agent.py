import os
import json
import asyncio
from dataclasses import dataclass
import threading
import time
import urllib.request
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext, ToolDefinition
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
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

research_model = llm.research_model
finalize_model = llm.finalize_model

RATE_LIMIT_REPLY = (
    "models are getting hammered rn - give it a min and text again"
)

_CONVO_TTL_SECONDS = 24 * 3600
_CONVO_MAX_MESSAGES = 24  # ~12 back-and-forth turns
_CONVO_SUMMARIZE_AT = 18
_CONVO_KEEP_RECENT = 10


def _convo_key(sender: str) -> str:
    digits = "".join(c for c in sender if c.isdigit())
    return f"conv:{digits}"


async def _load_history(sender: str) -> list:
    try:
        data = await cache.cache_get(_convo_key(sender), _CONVO_TTL_SECONDS)
        if data:
            messages = ModelMessagesTypeAdapter.validate_python(data)
            sanitized = _sanitize_history(messages)
            return await _compact_history(sanitized)
    except Exception as e:
        print("failed to load conversation history:", e)
    return []


async def _clear_history(sender: str) -> None:
    try:
        await cache.cache_delete(_convo_key(sender))
    except Exception as e:
        print("failed to clear conversation history:", e)


def _sanitize_history(messages: list) -> list:
    """Drop orphan tool results and incomplete tool-call tails from cached history."""
    if not messages:
        return []

    msgs = list(messages)

    while msgs and isinstance(msgs[0], ModelRequest):
        parts = msgs[0].parts
        if parts and all(isinstance(p, ToolReturnPart) for p in parts):
            msgs.pop(0)
            continue
        break

    valid: list = []
    pending: set[str] = set()

    for msg in msgs:
        if isinstance(msg, ModelResponse):
            for part in msg.parts:
                if isinstance(part, ToolCallPart):
                    pending.add(part.tool_call_id)
            valid.append(msg)
            continue

        if isinstance(msg, ModelRequest):
            orphan = False
            for part in msg.parts:
                if isinstance(part, ToolReturnPart):
                    if part.tool_call_id not in pending:
                        orphan = True
                        break
                    pending.discard(part.tool_call_id)
            if orphan:
                return _sanitize_history(valid)
            valid.append(msg)
            continue

        valid.append(msg)

    while valid:
        last = valid[-1]
        if isinstance(last, ModelResponse):
            has_tool_calls = any(isinstance(p, ToolCallPart) for p in last.parts)
            has_text = any(isinstance(p, TextPart) for p in last.parts)
            if has_tool_calls and not has_text:
                valid.pop()
                continue
        break

    if len(valid) > _CONVO_MAX_MESSAGES:
        return _sanitize_history(valid[-_CONVO_MAX_MESSAGES:])

    return valid


def _messages_to_transcript(messages: list) -> str:
    lines: list[str] = []
    for msg in messages:
        if isinstance(msg, ModelRequest):
            for part in msg.parts:
                if isinstance(part, UserPromptPart):
                    lines.append(f"boss: {part.content}")
                elif isinstance(part, ToolReturnPart):
                    content = str(part.content or "")
                    if len(content) > 400:
                        content = content[:399] + "…"
                    lines.append(f"tool ({part.tool_name}): {content}")
        elif isinstance(msg, ModelResponse):
            for part in msg.parts:
                if isinstance(part, TextPart) and part.content:
                    lines.append(f"you: {part.content}")
    return "\n".join(lines)


_summary_agent = Agent(
    llm.fast_model,
    system_prompt=(
        "Summarize this SMS thread between a VC boss and their research analyst. "
        "Keep only open tasks, startup names/slugs, decisions, and unresolved questions. "
        "Max 120 words. Lowercase plain text, no markdown."
    ),
    model_settings=llm.SUMMARY_SETTINGS,
)


async def _compact_history(messages: list) -> list:
    if len(messages) <= _CONVO_SUMMARIZE_AT:
        return messages

    old = messages[:-_CONVO_KEEP_RECENT]
    recent = messages[-_CONVO_KEEP_RECENT:]
    transcript = _messages_to_transcript(old)
    if not transcript.strip():
        return recent

    try:
        res = await _summary_agent.run(transcript)
        summary = (res.output or "").strip()
        if not summary:
            return recent
        summary_msg = ModelRequest(
            parts=[UserPromptPart(content=f"[earlier conversation summary]\n{summary}")]
        )
        return _sanitize_history([summary_msg] + recent)
    except Exception as e:
        print("history summarization failed, truncating instead:", e)
        return recent


async def _save_history(sender: str, messages: list) -> None:
    try:
        sanitized = _sanitize_history(messages)
        if not sanitized:
            return
        data = ModelMessagesTypeAdapter.dump_python(sanitized, mode="json")
        await cache.cache_set(_convo_key(sender), data)
    except Exception as e:
        print("failed to save conversation history:", e)


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
- Do NOT use markdown formatting of any kind: no **bold**, no *italics*, no bullet lists, no headers, no backticks. Plain text only.
- Use exactly 1 line of whitespace (one empty line) to separate things for easy readability."""

COST_RULES = """Output discipline:
- Reply with only essential info. No preamble or recap unless asked.
- Prefer one short paragraph or a few tight lines over long explanations.
- Put full detail in memory tools (save_startup, write_preference), not in your reply.
- SMS replies: aim for ~400 characters unless the boss asked for a list or deep dive."""

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
- Do all required tool calls first, then send your final text reply.

""" + COST_RULES


TEXT_HANDLER_RULES = """You process inbound texts from the boss for the VC workflow.

You have tools to search the web (exa_deep_search, exa_deep_search_many for discovery; linkup_search, linkup_search_many, linkup_fetch for news/facts/press), recall your memory (supermemory_search), save startups (save_startup, save_startups), approve/pass them (update_startup_status, update_startup_statuses), check press (check_press_coverage, check_press_coverage_many), record learnings (write_preference, write_preferences, write_reflection), and update the thesis (update_thesis). You can also react to texts using send_tapback_reaction.

Search routing: startup discovery → Exa. News, press checks, quick facts → Linkup.

Prefer batch tools whenever you have multiple searches, saves, status changes, or preferences to write.

If asked to "find new startups" or run a "scout sweep", search broadly, reflect on what holds up against the thesis, do targeted follow-up research, and save ALL genuine finds with save_startups in one call before replying. Skip any startup already in the known list unless the boss explicitly asks you to revisit it.

To approve or pass startups, use update_startup_statuses when changing more than one. If the boss wants to change investment criteria, use update_thesis.

Runtime context (thesis, patterns, known startups) arrives in the user message each turn — use that for current filters.

Your replies go out as plain iMessage texts. Never use markdown, asterisks, or formatting.

""" + STYLE_RULES


SCOUT_RULES = """You are running an autonomous scouting sweep for pre-seed AI startups.

Work through the sweep in disciplined turns: search broadly, reflect critically, do targeted deep research to confirm a thesis, then save ALL genuine finds with save_startups (one batch call) and record your learnings. Be specific about the signals that make a startup interesting or not. Do not finish a turn until the work for that turn is fully done.

""" + STYLE_RULES


RESEARCH_PHASE_RULES = """Research phase (Haiku):
- Gather evidence with search and memory tools only.
- Do NOT call save_startup, save_startups, write_preference, write_preferences, write_reflection, write_market_brief, or update_thesis.
- End each turn with a concise summary of findings and recommended next steps for the senior analyst."""

FINALIZE_PHASE_RULES = """Finalization phase (Sonnet):
- Review the research above. Persist startups, preferences, reflections, and briefs with your write/save tools.
- Send the final reply to the boss. Do NOT run new web searches unless a critical fact is completely missing.
- Write assessments and reflections with care — you are the only phase that writes to memory.

""" + STYLE_RULES + "\n\n" + COST_RULES


NEWS_STATIC_RULES = f"""Sources you monitor:
{monitored_sources_text()}"""


text_research_agent = Agent(
    research_model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + TEXT_HANDLER_RULES + "\n\n" + RESEARCH_PHASE_RULES,
    model_settings=llm.RESEARCH_SETTINGS,
)

text_finalize_agent = Agent(
    finalize_model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + TEXT_HANDLER_RULES + "\n\n" + FINALIZE_PHASE_RULES,
    model_settings=llm.FINALIZE_SMS_SETTINGS,
)

scout_research_agent = Agent(
    research_model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + SCOUT_RULES + "\n\n" + RESEARCH_PHASE_RULES,
    model_settings=llm.RESEARCH_SETTINGS,
)

scout_finalize_agent = Agent(
    finalize_model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + SCOUT_RULES + "\n\n" + FINALIZE_PHASE_RULES,
    model_settings=llm.FINALIZE_SCOUT_SETTINGS,
)

news_research_agent = Agent(
    research_model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + NEWS_DIGEST_RULES + "\n\n" + NEWS_STATIC_RULES + "\n\n" + RESEARCH_PHASE_RULES,
    model_settings=llm.RESEARCH_SETTINGS,
)

news_finalize_agent = Agent(
    finalize_model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt=CORE_RULES + "\n\n" + NEWS_DIGEST_RULES + "\n\n" + NEWS_STATIC_RULES + "\n\n" + FINALIZE_PHASE_RULES,
    model_settings=llm.FINALIZE_NEWS_SETTINGS,
)

FEEDBACK_RULES = """You process dashboard feedback for a VC scout's dealflow.

Your job:
- Distill the user's reason into a concise, reusable learning pattern.
- Save it with write_preference. type must be "approved" (seek) for approve reasons, "passed" (avoid) for pass reasons.
- If the dashboard status is approved or passed, call update_startup_status with the slug, that status, and reason set to your distilled one-liner.
- If status is new, only call write_preference unless they clearly want a status change.

Rules:
- Never touch Supabase. Supermemory only.
- Do not call search tools or update_thesis.
- Finish all tool calls before replying.
- Reply with one short lowercase confirmation of what you saved."""

feedback_agent = Agent(
    finalize_model,
    system_prompt=FEEDBACK_RULES + "\n\n" + COST_RULES,
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


async def _text_runtime_context() -> str:
    thesis = await sm.load_thesis()
    preferences = await sm.load_preferences()
    known = await sm.known_startups_brief()
    return (
        f"Current thesis:\n{thesis}\n\n"
        f"Patterns (seek/avoid):\n{preferences}\n\n"
        f"Known startups (skip unless boss asks to revisit):\n{known}"
    )


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
                "text": {"max_characters": 1500},
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


def register_research_tools(
    agent: Agent,
    *,
    dealflow: bool = True,
    tapback: bool = True,
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


def register_finalize_tools(
    agent: Agent,
    *,
    dealflow: bool = True,
    thesis_update: bool = True,
    market_brief: bool = False,
):
    if dealflow:

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
            """Save this week's structured VC market-intel digest to memory. Include full URLs for every cited article."""
            date = await sm.write_market_brief(brief, headline)
            return f"Saved market brief for {date}."

    if thesis_update:

        @agent.tool(prepare=make_non_strict)
        async def update_thesis(ctx: RunContext, new_content: str) -> str:
            """Update the investment thesis when the boss requests a change in criteria."""
            await sm.update_thesis(new_content)
            return "Updated the investment thesis."


register_research_tools(text_research_agent, linkup_tools=True)
register_research_tools(scout_research_agent, linkup_tools=True)
register_research_tools(
    news_research_agent,
    dealflow=False,
    tapback=False,
    exa=False,
    linkup_tools=True,
)

register_finalize_tools(text_finalize_agent, thesis_update=True)
register_finalize_tools(scout_finalize_agent, thesis_update=True)
register_finalize_tools(news_finalize_agent, dealflow=False, thesis_update=False, market_brief=True)
register_finalize_tools(
    feedback_agent,
    dealflow=True,
    thesis_update=False,
    market_brief=False,
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


_FINALIZE_PROMPT = (
    "Review the research above. Complete any saves, status updates, thesis changes, "
    "reflections, and preferences needed, then send the boss your final reply."
)


async def run_scout() -> dict:
    try:
        thesis = await sm.load_thesis()
        preferences = await sm.load_preferences()
        known = await sm.known_startups_summary()
        deps = _default_deps(sender="system")

        r1 = await agent_run_with_retry(
            scout_research_agent,
            f"Execute a scout sweep. Use exa_deep_search_many with 5+ diverse queries in ONE call to find pre-seed AI startups.\n\nThesis:\n{thesis}\n\nRemember these patterns:\n{preferences}\n\nYou ALREADY KNOW these startups - do NOT research or save them again, find NEW ones:\n{known}",
            deps=deps,
        )

        r2 = await agent_run_with_retry(
            scout_research_agent,
            "Reflect on what you found. Which candidates are genuinely interesting and why? Which should we skip and why? Be specific about signals. Do not save yet.",
            message_history=r1.all_messages(),
            deps=deps,
        )

        r3 = await agent_run_with_retry(
            scout_research_agent,
            "For every top candidate: run targeted exa_deep_search_many to confirm your thesis, "
            "then check_press_coverage_many for ALL candidates. Skip any with press hits. "
            "Write a qualitative assessment for each survivor in your reply. Do NOT save yet.",
            message_history=r2.all_messages(),
            deps=deps,
        )

        r4 = await agent_run_with_retry(
            scout_finalize_agent,
            "Save every press-clear survivor with save_startups (one batch call). "
            "Then call write_preferences with all new patterns and write_reflection with your sweep notes. "
            "Finish with a short summary reply. Do not reply until all save/write tools have been called.",
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
        thesis = await sm.load_thesis()
        preferences = await sm.load_preferences()
        from_date = linkup.week_ago_date()
        search_specs = "\n".join(
            f"- {s['q']} | domains: {s.get('include_domains') or 'any'}"
            for s in DIGEST_LINKUP_SEARCHES
        )

        r1 = await agent_run_with_retry(
            news_research_agent,
            f"Run this week's market-intel research. Call linkup_search_many ONCE with from_date={from_date} "
            f"and these searches (pass each as a LinkupSearchQuery with q, include_domains, depth):\n"
            f"{search_specs}\n\n"
            f"Current thesis (hard filters fixed — do not change):\n{thesis}\n\n"
            f"Existing soft patterns:\n{preferences}\n\n"
            "Cover all three buckets: VC news, fund blogs, individual investors.",
            deps=deps,
        )

        r2 = await agent_run_with_retry(
            news_research_agent,
            "Reflect on what you read. What themes matter for our pre-seed AI sourcing? "
            "What should we seek or avoid in SOFT scoring (not hard filters)? "
            "How can we find better picks this week? Do not save yet.",
            message_history=r1.all_messages(),
            deps=deps,
        )

        r3 = await agent_run_with_retry(
            news_finalize_agent,
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
    context = await _text_runtime_context()
    prompt = f"{context}\n\nThe boss sent this message: '{message}'. Handle it."
    if slug:
        prompt += f" Context startup slug: {slug}."

    deps = _default_deps(sender=sender, message_handle=message_handle)
    history = await _load_history(sender) if sender else []

    for attempt in range(2):
        try:
            r_research = await agent_run_with_retry(
                text_research_agent,
                prompt,
                deps=deps,
                message_history=history if history else None,
            )
            r_final = await agent_run_with_retry(
                text_finalize_agent,
                _FINALIZE_PROMPT,
                deps=deps,
                message_history=r_research.all_messages(),
            )
            if sender:
                await _save_history(sender, r_final.all_messages())
            return {"reply": r_final.output}
        except Exception as e:
            if llm._is_rate_limit_error(e):
                return {"reply": RATE_LIMIT_REPLY}
            if attempt == 0 and sender and llm.is_broken_history_error(e):
                print("broken conversation history, clearing cache and retrying:", e)
                await _clear_history(sender)
                history = []
                continue
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

    return {"error": "unknown mode"}
