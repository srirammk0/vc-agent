import os
from datetime import datetime, timezone

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from openai import AsyncOpenAI

from tools.exa import search, linkedin_search, get_contents
import brain as memory

nim_client = AsyncOpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"],
)

model = OpenAIChatModel(
    "stepfun-ai/step-3.7-flash",
    provider=OpenAIProvider(openai_client=nim_client),
)

# NIM models can return empty choices with a system prompt unless max_tokens is set.
NIM_MODEL_SETTINGS = {"max_tokens": 4096}


def _system_prompt(mode: str) -> str:
    thesis = memory.load_thesis()
    brain_state = memory.brain_for_prompt(include_conversation=(mode == "chat"))

    return f"""
You are a world-class pre-seed VC research analyst working for one investor.
You are sharp, opinionated, fast, and you have persistent memory. You talk to
the investor over iMessage, so your final replies must be concise and human.

YOUR THESIS (what the investor wants to back):
{thesis}

YOUR MEMORY (persistent across runs — this is what you already know):
{brain_state}

TOOLS (batched — pass MANY queries/URLs at once, never one per call):
- search(queries, category) — discovery. Pass a LIST of distinct query angles; they run
  in parallel. category="company" or "news". Cheap, URLs only.
- linkedin_search(queries) — LinkedIn signals (raises, launches, accelerator news). Also
  takes a LIST and runs in parallel.
- get_contents(urls) — fetch full text for the best NEW URLs in one batched call (cap ~8).
- save_startup(..., score) — write a new/updated startup to long-term memory. Judge the
  0-100 score yourself against the thesis and pass it. ALWAYS call this for genuinely new
  finds or meaningful updates.
- mark_seen(url) — record a URL so future sweeps skip it.
- remember(note) — save a durable insight or a preference the investor tells you.

RULES:
- Be efficient: batch your queries. Call search ONCE with all your angles, not repeatedly.
- Use your memory. Do NOT re-report startups already in KNOWN STARTUPS unless something
  changed. Skip URLs you've already seen.
- Be aggressive and thorough in research, but ruthless about quality — only surface things
  that genuinely fit the thesis.
- Persist what matters via save_startup / remember so you get smarter every run.

MODE: {mode}
""" + (_SWEEP_INSTRUCTIONS if mode == "sweep" else _CHAT_INSTRUCTIONS)


_SWEEP_INSTRUCTIONS = """
This is an autonomous RESEARCH SWEEP (no human is waiting live). Be FAST and batched:
1. Call search ONCE with 6-8 distinct angles (new raises, stealth launches, accelerator
   batches, building-in-public, vertical AI, dev tools) and linkedin_search ONCE with a
   few raise/launch queries.
2. get_contents ONCE on the most promising NEW candidates (up to ~8).
3. save_startup for everything that fits (score >= 50), assigning each a 0-100 score.
   mark_seen the URLs you processed.
4. remember any useful new pattern.
Your FINAL message is a short iMessage to the investor summarizing the sweep:
lead with the best new finds (name — one-liner — score — link), then a one-line tally.
If nothing good was found, say so briefly. Keep it under ~12 lines. Plain text, no markdown.
"""

_CHAT_INSTRUCTIONS = """
This is a live CHAT with the investor over iMessage. The latest message is your task.
- Answer directly and conversationally using your memory first.
- If they ask you to research, dig, or find something, USE YOUR TOOLS (batched) and do it
  now, then save_startup / remember as appropriate.
- If they state a preference or correction, call remember to keep it.
Your FINAL message is the iMessage reply: natural, concise, no markdown, no preamble.
"""


def _build_agent(mode: str) -> Agent:
    return Agent(
        model=model,
        system_prompt=_system_prompt(mode),
        model_settings=NIM_MODEL_SETTINGS,
        tools=[
            search,
            linkedin_search,
            get_contents,
            memory.save_startup,
            memory.mark_seen,
            memory.remember,
        ],
        # Models occasionally emit a malformed tool call; let them self-correct.
        retries=2,
    )


async def run_agent(payload: dict) -> dict:
    mode = payload.get("mode", "sweep")
    message = payload.get("message", "")
    memory.init_brain(payload.get("brain"))

    if mode == "chat":
        memory.add_conversation_turn("user", message)
        prompt = message or "Hello"
    else:
        prompt = (
            "Run a full autonomous research sweep now. Find new pre-seed AI startups "
            "that fit the thesis, save them to memory, and report back."
        )

    agent = _build_agent(mode)
    result = await agent.run(prompt)
    reply = (result.output or "").strip()

    if mode == "chat":
        memory.add_conversation_turn("agent", reply)
    else:
        found = sum(
            1
            for s in memory.get_brain()["startups"].values()
            if s.get("updated") == datetime.now(timezone.utc).strftime("%Y-%m-%d")
        )
        memory.add_run_record("sweep", reply[:280], found)

    return {"mode": mode, "reply": reply, "brain": memory.get_brain()}
