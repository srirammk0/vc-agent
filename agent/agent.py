import os
from datetime import datetime, timezone

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from openai import AsyncOpenAI

from tools.exa import exa_search, exa_get_contents, social_search
from tools.scorer import score_startup
import brain as memory

nim_client = AsyncOpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"],
)

model = OpenAIChatModel(
    "minimaxai/minimax-m3",
    provider=OpenAIProvider(openai_client=nim_client),
)


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

TOOLS:
- exa_search(query, category) — discovery. category="company" or "news". Cheap, URLs only.
- social_search(query) — LinkedIn signals (raises, launches, accelerator news).
- exa_get_contents(urls) — fetch full text for the most promising URLs only (costs more).
- score_startup(startup_data) — score a candidate 0-100 against the thesis.
- save_startup(...) — write a new/updated startup to long-term memory. ALWAYS call this
  for genuinely new finds or meaningful updates.
- mark_seen(url) — record a URL so future sweeps skip it.
- remember(note) — save a durable insight or a preference the investor tells you.

RULES:
- Use your memory. Do NOT re-report startups already in KNOWN STARTUPS unless something
  changed. Skip URLs you've already seen.
- Be aggressive and thorough in research, but ruthless about quality — only surface things
  that genuinely fit the thesis.
- Persist what matters via save_startup / remember so you get smarter every run.

MODE: {mode}
""" + (_SWEEP_INSTRUCTIONS if mode == "sweep" else _CHAT_INSTRUCTIONS)


_SWEEP_INSTRUCTIONS = """
This is an autonomous RESEARCH SWEEP (no human is waiting live).
1. Run several exa_search + social_search queries across different angles (new raises,
   stealth launches, accelerator batches, building-in-public, vertical AI, dev tools).
2. exa_get_contents on the most promising NEW candidates (5-10 max).
3. score_startup each, then save_startup for everything scoring >= 50. mark_seen URLs.
4. remember any useful new pattern.
Your FINAL message is a short iMessage to the investor summarizing the sweep:
lead with the best new finds (name — one-liner — score — link), then a one-line tally.
If nothing good was found, say so briefly. Keep it under ~12 lines. Plain text, no markdown.
"""

_CHAT_INSTRUCTIONS = """
This is a live CHAT with the investor over iMessage. The latest message is your task.
- Answer directly and conversationally using your memory first.
- If they ask you to research, dig, or find something, USE YOUR TOOLS and do it now,
  then save_startup / remember as appropriate.
- If they state a preference or correction, call remember to keep it.
Your FINAL message is the iMessage reply: natural, concise, no markdown, no preamble.
"""


def _build_agent(mode: str) -> Agent:
    return Agent(
        model=model,
        system_prompt=_system_prompt(mode),
        tools=[
            exa_search,
            exa_get_contents,
            social_search,
            score_startup,
            memory.save_startup,
            memory.mark_seen,
            memory.remember,
        ],
        # Models occasionally emit a malformed tool call; let them self-correct.
        retries=4,
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
