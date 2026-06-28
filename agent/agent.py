import os
import sys
import time
import json
from datetime import datetime, timezone

import logfire
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from openai import AsyncOpenAI

from tools.exa import exa_search, exa_get_contents, social_search
from tools.firecrawl import firecrawl_scrape
from tools.scorer import score_startup
from brain import load_thesis, write_startup, write_run_log, update_index, load_known_startups

logfire.configure()
logfire.instrument_pydantic_ai()

nim_client = AsyncOpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"],
)

# IMPORTANT: always pass chat_template_kwargs or NIM hangs indefinitely on DeepSeek V4
model = OpenAIChatModel(
    "deepseek-ai/deepseek-v4-pro",
    provider=OpenAIProvider(openai_client=nim_client),
)


async def run_agent(payload: dict) -> dict:
    start_time = time.time()

    thesis = load_thesis()
    known = load_known_startups()
    trigger_type = payload.get("trigger", "scheduled")
    timestamp = payload.get("timestamp", datetime.now(timezone.utc).isoformat())
    monitor_context = payload.get("monitor_context", None)

    monitor_section = ""
    if monitor_context:
        monitor_section = f"""
MONITOR TRIGGER CONTEXT:
A Firecrawl monitor detected new content on: {monitor_context.get('url', 'unknown')}
Monitor name: {monitor_context.get('monitor_name', 'unknown')}
Focus your queries on this specific source/platform rather than running a full sweep.
Run 3-4 targeted queries relevant to what this monitor watches.
"""

    system_prompt = f"""
You are a startup research assistant for a pre-seed VC investor.

Your job is to find and evaluate early-stage AI startups.
Use your tools in this specific order for maximum efficiency:

TOOL USAGE RULES:
1. exa_search — use first for all discovery. Cheap, returns URLs only. Run 6-8 queries
   covering different angles (company search, news, YC/SPC/FoundersInc signals).
   Pass category="company" for company discovery, category="news" for announcements.
2. social_search — use for X/LinkedIn signals (pre-seed announcements, accelerator news).
   Run 3-4 social queries per scheduled run.
3. exa_get_contents — use ONLY for promising candidates from step 1/2 that aren't in the
   known list. Fetches full content. Limit to 5-8 URLs max per run to control costs.
4. firecrawl_scrape — use ONLY if exa_get_contents doesn't return enough signal for a
   specific startup's landing page. Use sparingly (1-2 per run max).
5. score_startup — score each enriched startup.
6. write_startup — write to brain for any startup scoring >= 50.

{monitor_section}

THESIS:
{thesis}

ALREADY KNOWN STARTUPS (skip these entirely):
{known}

TRIGGER TYPE: {trigger_type}
- "scheduled": full sweep, all tools, 6-8 exa_search + 3-4 social_search queries
- "social": social signals only, just social_search (3-4 queries), no exa_get_contents or firecrawl
- "firecrawl_monitor": targeted sweep based on monitor context above, 3-4 focused queries
- "manual": same as scheduled

OUTPUT: Return ONLY valid JSON (no markdown wrapping). Schema:
{{
  "trigger": string,
  "timestamp": string,
  "duration_seconds": number,
  "queries_run": number,
  "pages_enriched": number,
  "startups_found": number,
  "startups_updated": number,
  "alerts_sent": number,
  "skipped_known": number,
  "new_startups": [string],
  "high_signal": [string],
  "high_signal_details": [
    {{
      "name": string,
      "slug": string,
      "score": number,
      "one_liner": string,
      "website": string,
      "founder_linkedin": string
    }}
  ]
}}
"""

    agent = Agent(
        model=model,
        system_prompt=system_prompt,
        tools=[exa_search, exa_get_contents, social_search, firecrawl_scrape, score_startup, write_startup],
        model_settings={
            "extra_body": {
                "chat_template_kwargs": {"thinking": False}
            }
        },
    )

    result = await agent.run(f"Run a {trigger_type} research sweep. Return a JSON summary.")

    duration = round(time.time() - start_time, 1)
    run_summary = _parse_agent_output(result.output, trigger_type, timestamp, duration)

    write_run_log(run_summary, payload)
    update_index()

    return run_summary


def _parse_agent_output(output: str, trigger: str, timestamp: str, duration: float) -> dict:
    try:
        cleaned = output.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
        data = json.loads(cleaned)
        data.setdefault("trigger", trigger)
        data.setdefault("timestamp", timestamp)
        data.setdefault("duration_seconds", duration)
        return data
    except (json.JSONDecodeError, ValueError):
        print("[agent] Failed to parse JSON output, returning skeleton", file=sys.stderr)
        return {
            "trigger": trigger,
            "timestamp": timestamp,
            "duration_seconds": duration,
            "queries_run": 0,
            "pages_enriched": 0,
            "startups_found": 0,
            "startups_updated": 0,
            "alerts_sent": 0,
            "skipped_known": 0,
            "new_startups": [],
            "high_signal": [],
            "high_signal_details": [],
        }
