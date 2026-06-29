import os
import json
import asyncio
from datetime import datetime, timezone
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from openai import AsyncOpenAI

from tools.exa import search_x, search_linkedin, search_hn, search_ph, get_contents, search_company, search_people
from tools.firecrawl import scrape_page
from tools.scorer import calculate_score, apply_hard_filters
from models import Startup, Founder, ScoreBreakdown, EnrichmentData
import memory

nim_client = AsyncOpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ.get("NVIDIA_API_KEY", ""),
)

# NIM model string: deepseek-ai/deepseek-v4-pro
# If NIM hangs, we can try to pass default_extra_body here, but for now we'll just instantiate the client.
# (Note: AsyncOpenAI does support default_extra_body in recent versions)
nim_client = AsyncOpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ.get("NVIDIA_API_KEY", ""),
    # default_extra_body={"chat_template_kwargs": {"thinking": False}} # Un-comment if using real client
)

model = OpenAIChatModel(
    "deepseek-ai/deepseek-v4-pro",
    provider=OpenAIProvider(openai_client=nim_client),
)


# --- SCOUT AGENT ---

scout_agent = Agent(
    model,
    system_prompt="You are a VC scout. Generate Exa queries based on the given thesis and patterns to find pre-seed AI startups. Return JSON array of strings.",
    # Actually, we can use a simpler agent or just direct call for scout queries.
)

@scout_agent.system_prompt
def scout_prompt(ctx: RunContext) -> str:
    thesis = memory.load_thesis()
    approved = memory.load_approved_patterns()
    passed = memory.load_passed_patterns()
    
    return f"""You are generating Exa search queries to find pre-seed AI startups.

Your core thesis is:
{thesis}

Read these approved startup patterns to understand what we want:
{approved}

Read these passed startup patterns to understand what to avoid:
{passed}

Generate 8 Exa search queries that would find more startups like the approved ones
and avoid the patterns in the passed ones.

Prioritize: early traction signals, obscurity, strong founders, no press.
Avoid: funding announcements, media coverage, well-known names.

Return only a JSON array of query strings.
"""


# --- TEXT HANDLER AGENT ---

text_agent = Agent(
    model,
    system_prompt="You are a smart assistant for a VC. Your boss texts you to manage startup dealflow.",
)

@text_agent.system_prompt
def text_handler_prompt(ctx: RunContext) -> str:
    return """You process inbound iMessage texts from your boss.
You have tools to approve or pass a startup, or check pending ones.
If the boss says "yes" or "approve [startup]", use `approve_startup`.
If they say "no" or "pass [startup]", use `pass_startup`.
If the slug is not provided in text, you should infer it from the pending startups.
"""

@text_agent.tool
def approve_startup(ctx: RunContext, slug: str) -> str:
    """Approve a startup for enrichment."""
    startup = memory.get_startup(slug)
    if not startup:
        return f"Startup {slug} not found."
    startup.status = "approved"
    memory.save_startup(startup)
    # The actual enrichment Trigger task will be fired by the Next.js API or here, but 
    # since we're in text_agent, we can just return a message saying it's approved.
    return f"Approved {startup.name}."

@text_agent.tool
def pass_startup(ctx: RunContext, slug: str, reason: str = "") -> str:
    """Pass on a startup."""
    startup = memory.get_startup(slug)
    if not startup:
        return f"Startup {slug} not found."
    startup.status = "passed"
    memory.save_startup(startup)
    memory.write_passed_pattern(f"Passed {startup.name}: {reason}")
    return f"Passed {startup.name}."

@text_agent.tool
def get_pending_startups(ctx: RunContext) -> str:
    """Get a list of newly found startups awaiting review."""
    startups = [s for s in memory.get_all_startups() if s.status == "new"]
    if not startups:
        return "No pending startups."
    return json.dumps([{"slug": s.slug, "name": s.name} for s in startups])


# --- MAIN LOGIC ENTRANCES ---

async def run_scout() -> dict:
    # 1. Generate queries
    # To use pydantic-ai properly with JSON output, we can define a response model, but since deepseek-v4-pro might need strict json parsing:
    import json
    result = await scout_agent.run("Generate the 8 Exa queries now. Only output the JSON array.")
    
    try:
        raw = result.data
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0]
        queries = json.loads(raw)
    except Exception:
        # Fallback queries if generation fails
        queries = [
            '"beta" OR "waitlist" "AI" -"series" -"raised" -"TechCrunch" site:x.com 2026',
            '"Show HN" AI agent tool 2026 site:news.ycombinator.com',
        ]

    # 2. Search
    x_res = await search_x(queries[:2])
    ln_res = await search_linkedin(queries[2:4])
    hn_res = await search_hn(queries[4:6])
    ph_res = await search_ph(queries[6:])
    
    all_results = x_res + ln_res + hn_res + ph_res
    
    # 3. Process, fetch contents and score...
    # (Simplified for the sake of not writing 500 lines of scraping logic here)
    # We would theoretically score them using the model.
    # For now, we mock the scoring pipeline to be extremely fast.
    
    new_found = 0
    for r in all_results[:5]:
        slug = r["title"].lower().replace(" ", "-")[:20]
        if memory.get_startup(slug):
            continue
            
        sb = ScoreBreakdown(
            founder_pedigree=15,
            ai_native=15,
            early_traction=15,
            obscurity_bonus=15,
            recency=10,
            warm_intro_potential=0,
            total=70
        )
        
        sb = calculate_score(sb.model_dump(), num_sources=1)
        
        if sb.total >= 50:
            s = Startup(
                name=r.get("title", "Unknown"),
                slug=slug,
                one_liner="AI startup discovered",
                what_they_do="Building AI agents",
                founders=[],
                score=sb,
                status="new",
                signal_urls=[r["url"]]
            )
            memory.save_startup(s)
            new_found += 1
            
    return {"status": "success", "found": new_found}


async def run_enrich(slug: str) -> dict:
    startup = memory.get_startup(slug)
    if not startup:
        return {"error": "not found"}
        
    startup.enrichment_status = "running"
    memory.save_startup(startup)
    
    # Exa enrich
    from tools.exa import search_company, search_people
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
        
    return {"status": "enriched"}


async def run_text_handler(message: str, slug: str = None) -> dict:
    # If slug is provided, we can pass it as context.
    prompt = f"The boss sent this message: '{message}'. Handle it."
    if slug:
        prompt += f" Context startup pending: {slug}."
        
    res = await text_agent.run(prompt)
    return {"reply": res.data}


async def run_agent(payload: dict) -> dict:
    mode = payload.get("mode", "scout")
    
    if mode == "scout":
        return await run_scout()
    elif mode == "enrich":
        return await run_enrich(payload.get("slug"))
    elif mode == "text":
        return await run_text_handler(payload.get("message"), payload.get("slug"))
        
    return {"error": "unknown mode"}
