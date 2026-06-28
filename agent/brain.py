"""
In-memory brain. Seeded from the JSON the TS task loads out of Vercel Blob,
mutated by agent tools during a run, then handed back to be persisted.

No filesystem, no database — the brain is just a dict that travels in/out
of the process. This keeps the agent fully stateless and cloud-safe while
still feeling stateful to the model (its memory is injected into the prompt).
"""
import re
from datetime import datetime, timezone

# Caps so the brain (and the prompt it feeds) stay bounded over time.
MAX_SEEN_URLS = 800
MAX_NOTES = 100
MAX_CONVERSATION = 30
MAX_RUNS = 30

def _empty() -> dict:
    return {
        "startups": {},
        "seen_urls": [],
        "notes": [],
        "conversation": [],
        "runs": [],
        "updated": None,
    }


_BRAIN: dict = _empty()


def init_brain(data: dict | None) -> None:
    global _BRAIN
    data = data or {}
    _BRAIN = {
        "startups": data.get("startups") or {},
        "seen_urls": data.get("seen_urls") or [],
        "notes": data.get("notes") or [],
        "conversation": data.get("conversation") or [],
        "runs": data.get("runs") or [],
        "updated": data.get("updated"),
    }


def get_brain() -> dict:
    # Trim to caps before handing back for persistence.
    _BRAIN["seen_urls"] = _BRAIN["seen_urls"][-MAX_SEEN_URLS:]
    _BRAIN["notes"] = _BRAIN["notes"][-MAX_NOTES:]
    _BRAIN["conversation"] = _BRAIN["conversation"][-MAX_CONVERSATION:]
    _BRAIN["runs"] = _BRAIN["runs"][-MAX_RUNS:]
    return _BRAIN


def _now_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "unknown"


# ---------- Agent-facing memory tools ----------

async def save_startup(
    name: str,
    website: str = "",
    one_liner: str = "",
    founders: str = "",
    stage: str = "",
    raised: str = "",
    location: str = "",
    score: int = 0,
    status: str = "new",
    signal: str = "",
) -> str:
    """
    Persist a startup to long-term memory (creates or updates by name).
    Call this for every genuinely new or meaningfully-updated startup you find.
    """
    slug = _slugify(name)
    existing = _BRAIN["startups"].get(slug, {})
    _BRAIN["startups"][slug] = {
        "slug": slug,
        "name": name,
        "website": website or existing.get("website", ""),
        "one_liner": one_liner or existing.get("one_liner", ""),
        "founders": founders or existing.get("founders", ""),
        "stage": stage or existing.get("stage", ""),
        "raised": raised or existing.get("raised", ""),
        "location": location or existing.get("location", ""),
        "score": score if score else existing.get("score", 0),
        "status": status or existing.get("status", "new"),
        "signal": signal or existing.get("signal", ""),
        "found": existing.get("found", _now_date()),
        "updated": _now_date(),
    }
    return f"saved startup '{name}' (slug={slug})"


async def mark_seen(url: str) -> str:
    """Record a URL as already processed so future sweeps skip it."""
    if url and url not in _BRAIN["seen_urls"]:
        _BRAIN["seen_urls"].append(url)
    return "ok"


async def remember(note: str) -> str:
    """
    Save a durable freeform insight to long-term memory (e.g. a thesis refinement,
    a pattern you noticed, or a preference the user told you in chat).
    """
    _BRAIN["notes"].append({"ts": _now_iso(), "note": note})
    return "remembered"


# ---------- Bookkeeping (called by main, not the model) ----------

def add_conversation_turn(role: str, content: str) -> None:
    _BRAIN["conversation"].append({"role": role, "content": content, "ts": _now_iso()})


def add_run_record(trigger: str, summary: str, found: int) -> None:
    _BRAIN["runs"].append(
        {"ts": _now_iso(), "trigger": trigger, "summary": summary, "found": found}
    )


# ---------- Prompt rendering ----------

def brain_for_prompt(include_conversation: bool) -> str:
    startups = _BRAIN["startups"]
    lines = [f"KNOWN STARTUPS ({len(startups)} total):"]
    if startups:
        # Most-recently-updated first, capped so the prompt stays lean.
        ordered = sorted(startups.values(), key=lambda s: s.get("updated", ""), reverse=True)
        for s in ordered[:60]:
            lines.append(
                f"- {s['name']} (score {s.get('score', 0)}, {s.get('status', 'new')}) "
                f"— {s.get('one_liner', '')[:120]} [{s.get('website', '')}]"
            )
    else:
        lines.append("- none yet")

    notes = _BRAIN["notes"]
    lines.append("")
    lines.append(f"MEMORY NOTES ({len(notes)}):")
    if notes:
        for n in notes[-25:]:
            lines.append(f"- {n.get('note', '')}")
    else:
        lines.append("- none yet")

    lines.append("")
    lines.append(f"(You have already seen {len(_BRAIN['seen_urls'])} URLs; avoid re-reporting those.)")

    if include_conversation and _BRAIN["conversation"]:
        lines.append("")
        lines.append("RECENT CONVERSATION (oldest first):")
        for turn in _BRAIN["conversation"][-12:]:
            who = "You" if turn["role"] == "user" else "Agent"
            lines.append(f"{who}: {turn['content']}")

    return "\n".join(lines)


def load_thesis() -> str:
    from pathlib import Path
    thesis_path = Path(__file__).parent.parent / "brain" / "thesis.md"
    return thesis_path.read_text() if thesis_path.exists() else "No thesis configured."
