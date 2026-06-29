import os
import json
import asyncio
from dataclasses import dataclass
import threading
import time
import urllib.request
from pydantic_ai import Agent, RunContext, ToolDefinition
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from openai import AsyncOpenAI

from tools.exa import exa
import memory_store as sm

cerebras_client = AsyncOpenAI(
    base_url="https://api.cerebras.ai/v1",
    api_key=os.environ.get("CEREBRAS_API_KEY", ""),
)

model = OpenAIChatModel(
    "gpt-oss-120b",
    provider=OpenAIProvider(openai_client=cerebras_client),
)


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
- Use exa_deep_search for web research and supermemory_search to recall your own memory."""


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


@hooks.on.before_model_request
def start_typing_indicator(ctx: RunContext[AgentDeps], request_context, **kwargs):
    deps = ctx.deps
    if not deps or not deps.phone_number:
        return request_context
    if deps.typing_thread and deps.typing_thread.is_alive():
        return request_context

    deps.stop_typing = threading.Event()
    headers = {
        "sb-api-key-id": deps.sb_key,
        "sb-api-secret-key": deps.sb_secret,
        "Content-Type": "application/json",
    }

    def typing_loop():
        while not deps.stop_typing.is_set():
            try:
                urllib.request.urlopen(urllib.request.Request(
                    "https://api.sendblue.co/api/send-typing-indicator",
                    data=json.dumps({
                        "number": deps.phone_number,
                        "from_number": deps.from_number
                    }).encode("utf-8"),
                    headers=headers,
                    method="POST"
                ))
            except Exception:
                pass
            for _ in range(30):
                if deps.stop_typing.is_set():
                    break
                time.sleep(0.1)

    deps.typing_thread = threading.Thread(target=typing_loop)
    deps.typing_thread.start()
    return request_context


@hooks.on.after_model_request
def stop_typing_indicator(ctx: RunContext[AgentDeps], response, **kwargs):
    deps = ctx.deps
    if not deps:
        return response
    if deps.stop_typing:
        deps.stop_typing.set()
    if deps.typing_thread:
        deps.typing_thread.join()
        deps.typing_thread = None
    return response


@text_agent.system_prompt
async def text_handler_prompt(ctx: RunContext) -> str:
    thesis = await sm.load_thesis()
    preferences = await sm.load_preferences()
    return f"""You process inbound texts from the boss for the VC workflow.

You have tools to search the web (exa_deep_search), recall your memory (supermemory_search), save startups (save_startup), approve/pass them (update_startup_status), record learnings (write_preference, write_reflection), and update the thesis (update_thesis). You can also react to texts using send_tapback_reaction.

If asked to "find new startups" or run a "scout sweep", search broadly, reflect on what holds up against the thesis, do targeted follow-up research, and save the genuine finds with save_startup.

To approve or pass a startup, use update_startup_status with status 'approved' or 'passed' and a short reason. If the boss wants to change investment criteria, use update_thesis.

Your core thesis is:
{thesis}

Patterns you've learned (seek/avoid):
{preferences}

{STYLE_RULES}
"""


@scout_agent.system_prompt
async def scout_prompt(ctx: RunContext) -> str:
    return f"""You are running an autonomous scouting sweep for pre-seed AI startups.

Work through the sweep in disciplined turns: search broadly, reflect critically, do targeted deep research to confirm a thesis, then save genuine finds and record your learnings. Be specific about the signals that make a startup interesting or not.

{STYLE_RULES}
"""


def make_non_strict(ctx: RunContext, tool_def: ToolDefinition) -> ToolDefinition:
    tool_def.strict = False
    return tool_def


def register_tools(agent: Agent):
    @agent.tool(prepare=make_non_strict)
    async def exa_deep_search(ctx: RunContext, query: str) -> str:
        """Search the web for a query and immediately return the deep text content of the top results for ultra-fast research."""
        try:
            res = await asyncio.to_thread(
                exa.search_and_contents,
                query,
                num_results=3,
                text={"max_characters": 2000},
            )
            results = []
            for r in getattr(res, "results", []):
                content = r.text if hasattr(r, "text") and r.text else "No content"
                results.append(f"Title: {r.title}\nURL: {r.url}\nContent: {content}\n---")
            return "\n".join(results) if results else "No results found."
        except Exception as e:
            return f"Exa search failed: {e}"

    @agent.tool(prepare=make_non_strict)
    async def supermemory_search(ctx: RunContext, query: str, container_tag: str = "vc:startups") -> str:
        """Search the agent's own memory semantically. container_tag is one of: vc:thesis, vc:preferences, vc:startups, vc:reflections."""
        return await sm.semantic_search(query, container_tag)

    @agent.tool(prepare=make_non_strict)
    async def save_startup(ctx: RunContext, slug: str, name: str, website: str, one_liner: str, assessment: str, signal_urls: list[str]) -> str:
        """Save a newly discovered startup to memory with a qualitative assessment. slug must be the kebab-case startup name."""
        await sm.save_startup(slug, name, website, one_liner, assessment, signal_urls)
        return f"Saved {name} ({slug}) to memory."

    @agent.tool(prepare=make_non_strict)
    async def update_startup_status(ctx: RunContext, slug: str, status: str, reason: str = "") -> str:
        """Approve or pass a startup. status must be 'approved' or 'passed'. Provide a short reason; it is recorded as a learning pattern."""
        result = await sm.update_startup_status(slug, status)
        if reason:
            pattern_type = "approved" if status == "approved" else "passed"
            await sm.write_preference(f"{status.capitalize()} {slug}: {reason}", pattern_type)
        return result

    @agent.tool(prepare=make_non_strict)
    async def write_preference(ctx: RunContext, pattern: str, type: str = "approved") -> str:
        """Save an explicit pattern to seek or avoid in future scouting. type is 'approved' (seek) or 'passed' (avoid)."""
        await sm.write_preference(pattern, type)
        return f"Saved {type} preference."

    @agent.tool(prepare=make_non_strict)
    async def write_reflection(ctx: RunContext, reflection: str) -> str:
        """Write a post-run self-improvement note about how the sweep went and what to do differently."""
        await sm.write_reflection(reflection)
        return "Saved reflection."

    @agent.tool(prepare=make_non_strict)
    async def update_thesis(ctx: RunContext, new_content: str) -> str:
        """Update the investment thesis when the boss requests a change in criteria."""
        await sm.update_thesis(new_content)
        return "Updated the investment thesis."

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


register_tools(text_agent)
register_tools(scout_agent)


# --- MAIN LOGIC ENTRANCES ---

def _default_deps(sender: str = None, message_handle: str = None) -> AgentDeps:
    return AgentDeps(
        phone_number=sender or os.environ.get("ALERT_PHONE_NUMBER", ""),
        from_number=os.environ.get("SENDBLUE_FROM_NUMBER", ""),
        sb_key=os.environ.get("SENDBLUE_API_KEY", ""),
        sb_secret=os.environ.get("SENDBLUE_API_SECRET", ""),
        message_handle=message_handle,
    )


async def run_scout() -> dict:
    thesis = await sm.load_thesis()
    preferences = await sm.load_preferences()
    deps = _default_deps(sender="system")

    # Turn 1: Broad search
    r1 = await scout_agent.run(
        f"Execute a scout sweep. Use exa_deep_search with 5+ diverse queries to find pre-seed AI startups.\n\nThesis:\n{thesis}\n\nRemember these patterns:\n{preferences}",
        deps=deps,
    )

    # Turn 2: Reflection
    r2 = await scout_agent.run(
        "Reflect on what you found. Which 3-5 are genuinely interesting and why? Which should we skip and why? Be specific about signals.",
        message_history=r1.all_messages(),
        deps=deps,
    )

    # Turn 3: Deep research + save
    r3 = await scout_agent.run(
        "For the top candidates you identified: do 1-2 more targeted exa_deep_search calls to confirm your thesis. Write a qualitative assessment for each and call save_startup for any that hold up.",
        message_history=r2.all_messages(),
        deps=deps,
    )

    # Turn 4: Self-improvement
    r4 = await scout_agent.run(
        "What patterns did you notice this sweep? Write 1-2 specific patterns to write_preference (what to seek or avoid) and a reflection to write_reflection. Be precise.",
        message_history=r3.all_messages(),
        deps=deps,
    )

    return {"reply": r4.output}


async def run_text_handler(message: str, slug: str = None, sender: str = None, message_handle: str = None) -> dict:
    prompt = f"The boss sent this message: '{message}'. Handle it."
    if slug:
        prompt += f" Context startup slug: {slug}."

    deps = _default_deps(sender=sender, message_handle=message_handle)
    res = await text_agent.run(prompt, deps=deps)
    return {"reply": res.output}


async def run_agent(payload: dict) -> dict:
    mode = payload.get("mode", "text")

    if mode == "scout":
        return await run_scout()
    elif mode == "text":
        return await run_text_handler(
            payload.get("message"),
            payload.get("slug"),
            payload.get("sender"),
            payload.get("message_handle"),
        )

    return {"error": "unknown mode"}
