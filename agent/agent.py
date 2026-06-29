import os
import json
import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass
import threading
import time
import urllib.request
from pydantic_ai import Agent, RunContext, ToolDefinition
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from openai import AsyncOpenAI

from tools.exa import exa, search_company, search_people
from tools.scorer import calculate_score
from models import Startup, ScoreBreakdown, EnrichmentData
import memory

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

text_agent = Agent(
    model,
    deps_type=AgentDeps,
    capabilities=[hooks],
    system_prompt="You are a smart assistant for a VC. Your boss texts you to manage startup dealflow and do deep research. Keep your responses super informal, casual, lowercase, concise, and sound like a human sending a quick iMessage. Use texting talk/slang naturally, do not use emojis at all, and never use greetings or say 'hey'. Use exactly 1 empty line of whitespace to separate thoughts.",
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
def text_handler_prompt(ctx: RunContext) -> str:
    thesis = memory.load_thesis()
    approved = memory.load_approved_patterns()
    passed = memory.load_passed_patterns()
    
    pending_list = [s for s in memory.get_all_startups() if s.status == "new"]
    pending_str = "\n".join([f"- {s.name} (slug: {s.slug}, score: {s.score.total}) - {s.one_liner}" for s in pending_list]) if pending_list else "none"

    return f"""You process inbound texts or system triggers for the VC workflow.
You are fully autonomous and have tools to manage the entire venture capital workflow, search the web, scrape pages, and check the Supabase database.

If asked to "find new startups" or run a "scout sweep", you MUST:
1. Formulate Exa search queries based on our thesis and learning patterns.
2. Use `exa_deep_search` to find new pre-seed AI startups and read their website contents simultaneously.
3. Score them immediately against the thesis based on the deep search results.
4. Use `save_new_startup` to store good candidates in Supabase.
(Do this autonomously and extremely fast, you are under a 10-minute time limit).

Other Tool Use:
- To approve or pass, use `approve_startup` / `pass_startup`.
- To check DB state, use `check_supabase_startups`, `check_supabase_runs`, or `check_startup_details`.
- To research further, use `enrich_startup_research`.
- You can react to texts using `send_tapback_reaction` (e.g., 'love', 'like', 'laugh'). You are welcome to still reply with a text even if you tapback.
If the slug is not provided, infer it from the pending startups.

Your core thesis is:
{thesis}

Read these approved startup patterns to understand what we want:
{approved}

Read these passed startup patterns to understand what to avoid:
{passed}

We currently have these pending startups awaiting review:
{pending_str}

Style rules:
- Be super informal, friendly, and casual.
- Write in lowercase (no capital letters unless needed).
- Keep it very concise (iMessage style).
- Use natural texting talk/slang, but not overly done. Sound like a human, not an AI.
- Do NOT use emojis at all.
- Do NOT say "hey" or "hi" or greet the user. Assume this is a continuation of an ongoing chat (no greetings).
- Do NOT use em dashes (—). Use hyphens (-) or standard punctuation.
- Use exactly 1 line of whitespace (one empty line) to separate things for easy readability.
"""

def make_non_strict(ctx: RunContext, tool_def: ToolDefinition) -> ToolDefinition:
    tool_def.strict = False
    return tool_def

@text_agent.tool(prepare=make_non_strict)
def approve_startup(ctx: RunContext, slug: str) -> str:
    """Approve a startup for enrichment."""
    startup = memory.get_startup(slug)
    if not startup:
        return f"Startup {slug} not found."
    startup.status = "approved"
    memory.save_startup(startup)
    return f"Approved {startup.name}."

@text_agent.tool(prepare=make_non_strict)
def pass_startup(ctx: RunContext, slug: str, reason: str = "") -> str:
    """Pass on a startup."""
    startup = memory.get_startup(slug)
    if not startup:
        return f"Startup {slug} not found."
    startup.status = "passed"
    memory.save_startup(startup)
    memory.write_passed_pattern(f"Passed {startup.name}: {reason}")
    return f"Passed {startup.name}."

@text_agent.tool(prepare=make_non_strict)
def get_pending_startups(ctx: RunContext) -> str:
    """Get a list of newly found startups awaiting review."""
    startups = [s for s in memory.get_all_startups() if s.status == "new"]
    if not startups:
        return "No pending startups."
    return json.dumps([{"slug": s.slug, "name": s.name} for s in startups])

@text_agent.tool(prepare=make_non_strict)
def update_thesis(ctx: RunContext, new_thesis: str) -> str:
    """Update the investment thesis in our database when the boss requests a change in criteria."""
    memory.update_thesis(new_thesis)
    return "Successfully updated the investment thesis."

@text_agent.tool(prepare=make_non_strict)
def add_learning_pattern(ctx: RunContext, pattern_type: str, pattern: str) -> str:
    """Add a new pattern (type must be 'approved' or 'passed') to help guide future scouting."""
    if pattern_type == "approved":
        memory.write_approved_pattern(pattern)
    elif pattern_type == "passed":
        memory.write_passed_pattern(pattern)
    else:
        return "Invalid pattern_type. Must be either 'approved' or 'passed'."
    return f"Successfully added {pattern_type} pattern."

@text_agent.tool(prepare=make_non_strict)
async def exa_deep_search(ctx: RunContext, query: str) -> str:
    """Search the web for specific queries and immediately return the deep text content of the top results for ultra-fast research."""
    try:
        res = await asyncio.to_thread(
            exa.search_and_contents,
            query,
            num_results=3,
            text={"max_characters": 2000}
        )
        results = []
        for r in getattr(res, "results", []):
            content = r.text if hasattr(r, 'text') and r.text else "No content"
            results.append(f"Title: {r.title}\nURL: {r.url}\nContent: {content}\n---")
        return "\n".join(results) if results else "No results found."
    except Exception as e:
        return f"Exa search failed: {e}"

@text_agent.tool(prepare=make_non_strict)
def save_new_startup(ctx: RunContext, name: str, slug: str, one_liner: str, url: str, what_they_do: str, founder_pedigree: int, ai_native: int, early_traction: int, obscurity_bonus: int, recency: int, warm_intro_potential: int) -> str:
    """Save a newly discovered startup to the database after scoring it.
    Provide score components out of their max points (founder_pedigree/25, ai_native/20, early_traction/20, obscurity_bonus/15, recency/10, warm_intro_potential/10).
    """
    sb = ScoreBreakdown(
        founder_pedigree=founder_pedigree,
        ai_native=ai_native,
        early_traction=early_traction,
        obscurity_bonus=obscurity_bonus,
        recency=recency,
        warm_intro_potential=warm_intro_potential,
        total=0 # Will be calculated
    )
    
    sb = calculate_score(sb.model_dump(), num_sources=1)
    
    s = Startup(
        name=name,
        slug=slug,
        one_liner=one_liner,
        what_they_do=what_they_do,
        founders=[],
        score=sb,
        status="new",
        signal_urls=[url]
    )
    memory.save_startup(s)
    memory.log_run("agentic_scout", f"Agent discovered and saved {name}.", 1)
    return f"Successfully saved {name} to Supabase with total score {sb.total}."

@text_agent.tool(prepare=make_non_strict)
async def enrich_startup_research(ctx: RunContext, slug: str) -> str:
    """Enrich and research a specific startup's details, founders, and domain writing."""
    res = await run_enrich(slug)
    if "error" in res:
        return f"Failed to enrich: {res['error']}"
    return f"Enriched startup {slug} and scraped founder details."

@text_agent.tool(prepare=make_non_strict)
def check_supabase_runs(ctx: RunContext) -> str:
    """Check the recent background runs (scouts, enrichments) from the Supabase database."""
    runs = memory.get_recent_runs()
    if not runs:
        return "No recent runs found."
    return json.dumps(runs)

@text_agent.tool(prepare=make_non_strict)
def check_supabase_startups(ctx: RunContext) -> str:
    """Get a summary of all startups currently stored in the Supabase database."""
    startups = memory.get_all_startups()
    if not startups:
        return "No startups found in database."
    summary = [{"slug": s.slug, "name": s.name, "status": s.status, "score": s.score.total if s.score else 0} for s in startups]
    return json.dumps(summary)

@text_agent.tool(prepare=make_non_strict)
def check_startup_details(ctx: RunContext, slug: str) -> str:
    """Get the full details of a specific startup from the Supabase database."""
    startup = memory.get_startup(slug)
    if not startup:
        return f"Startup {slug} not found."
    return startup.model_dump_json()

@text_agent.tool(prepare=make_non_strict)
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


# --- MAIN LOGIC ENTRANCES ---

async def run_enrich(slug: str) -> dict:
    startup = memory.get_startup(slug)
    if not startup:
        return {"error": "not found"}
        
    startup.enrichment_status = "running"
    memory.save_startup(startup)

    # Exa enrich
    company_data = await search_company(f"{startup.name} startup")
    people_data = await search_people(f"founder of {startup.name}")
    
    company_text = company_data[0]["text"] if company_data else ""
    people_text = people_data[0]["text"] if people_data else ""
    
    startup.enrichment = EnrichmentData(
        founder_linkedin_scraped=bool(people_data),
        domain_writing=f"Company: {company_text[:100]}... People: {people_text[:100]}..."
    )
    startup.enrichment_status = "complete"
    memory.save_startup(startup)
    
    # Write founder profile
    memory.save_founder(f"{slug}-founder", f"# Founder of {startup.name}\n\nEnriched background using Exa...\n\n{people_text}")
    
    # Write approved pattern
    memory.write_approved_pattern(f"Approved {startup.name}: scored {startup.score.total}.")
    
    # Update thesis (agentic)
    thesis = memory.load_thesis()
    if "Positive Examples" in thesis:
        thesis = thesis.replace("## Positive Examples", f"## Positive Examples\n- {startup.name}: Good early traction.")
        memory.update_thesis(thesis)
        
    memory.log_run("enrich", f"enriched startup {startup.name} (slug: {slug}) and scraped founder background.", 0)
    return {"status": "enriched"}


async def run_text_handler(message: str, slug: str = None, sender: str = None, message_handle: str = None) -> dict:
    # If slug is provided, we can pass it as context.
    prompt = f"The boss sent this message: '{message}'. Handle it."
    if slug:
        prompt += f" Context startup pending: {slug}."
        
    deps = AgentDeps(
        phone_number=sender or os.environ.get("ALERT_PHONE_NUMBER", ""),
        from_number=os.environ.get("SENDBLUE_FROM_NUMBER", ""),
        sb_key=os.environ.get("SENDBLUE_API_KEY", ""),
        sb_secret=os.environ.get("SENDBLUE_API_SECRET", ""),
        message_handle=message_handle
    )
        
    res = await text_agent.run(prompt, deps=deps)
    return {"reply": res.output}


async def run_agent(payload: dict) -> dict:
    mode = payload.get("mode", "text")
    
    if mode == "enrich":
        return await run_enrich(payload.get("slug"))
    elif mode == "text":
        return await run_text_handler(payload.get("message"), payload.get("slug"), payload.get("sender"), payload.get("message_handle"))
        
    return {"error": "unknown mode"}
