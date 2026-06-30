import asyncio
import hashlib
from datetime import datetime, timezone

from supermemory import Supermemory

_client = None


def get_client() -> Supermemory:
    global _client
    if _client is None:
        _client = Supermemory()
    return _client


def _result_text(r) -> str:
    """Best-effort extraction of a memory's text from a search result."""
    return getattr(r, "memory", None) or getattr(r, "chunk", None) or ""


def truncate_text(text: str, max_chars: int) -> str:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


async def load_thesis() -> str:
    try:
        res = await asyncio.to_thread(
            get_client().search.memories,
            q="investment thesis criteria",
            container_tag="vc:thesis",
            limit=1,
        )
        results = getattr(res, "results", [])
        if results:
            return truncate_text(_result_text(results[0]) or "No thesis configured.", 3500)
    except Exception as e:
        print("Failed to load thesis from Supermemory:", e)
    return "No thesis configured."


async def load_preferences() -> str:
    try:
        res = await asyncio.to_thread(
            get_client().search.memories,
            q="startup patterns preferences",
            container_tag="vc:preferences",
            limit=20,
        )
        results = getattr(res, "results", [])
        if results:
            text = "\n".join(_result_text(r) for r in results if _result_text(r))
            return truncate_text(text, 2500)
    except Exception as e:
        print("Failed to load preferences from Supermemory:", e)
    return "No preferences yet."


async def semantic_search(query: str, container_tag: str, limit: int = 10) -> str:
    try:
        res = await asyncio.to_thread(
            get_client().search.memories,
            q=query,
            container_tag=container_tag,
            search_mode="hybrid",
            limit=limit,
        )
        results = getattr(res, "results", [])
        joined = "\n---\n".join(_result_text(r) for r in results if _result_text(r))
        return joined or "No results."
    except Exception as e:
        return f"Search failed: {e}"


async def save_startup(
    slug: str,
    name: str,
    website: str,
    one_liner: str,
    assessment: str,
    signal_urls: list[str],
    status: str = "new",
):
    content = (
        f"Name: {name}\n"
        f"Website: {website}\n"
        f"One-liner: {one_liner}\n"
        f"Assessment: {assessment}\n"
        f"Signal URLs: {', '.join(signal_urls)}\n"
        f"Status: {status}"
    )
    await asyncio.to_thread(
        lambda: get_client().add(
            content=content,
            container_tag="vc:startups",
            custom_id=slug,
            metadata={
                "name": name,
                "website": website or "",
                "status": status,
                "found_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "one_liner": one_liner,
            },
            dreaming="dynamic",
        )
    )


async def save_startups_batch(
    items: list[dict],
) -> tuple[list[str], list[str]]:
    """Save many startups in parallel. Returns (saved_slugs, errors)."""

    async def _save_one(item: dict) -> tuple[str, str | None]:
        slug = item["slug"]
        try:
            await save_startup(
                slug=slug,
                name=item["name"],
                website=item.get("website", ""),
                one_liner=item["one_liner"],
                assessment=item["assessment"],
                signal_urls=item.get("signal_urls") or [],
            )
            return slug, None
        except Exception as e:
            return slug, str(e)

    results = await asyncio.gather(*[_save_one(item) for item in items])
    saved = [slug for slug, err in results if err is None]
    errors = [f"{slug}: {err}" for slug, err in results if err is not None]
    return saved, errors


async def update_startup_statuses_batch(
    updates: list[dict],
) -> tuple[list[str], list[str]]:
    """Update many startup statuses in parallel. Returns (updated_slugs, errors)."""

    async def _update_one(update: dict) -> tuple[str, str | None]:
        slug = update["slug"]
        try:
            msg = await update_startup_status(slug, update["status"])
            if "not found" in msg.lower():
                return slug, msg
            if update.get("reason"):
                pattern_type = "approved" if update["status"] == "approved" else "passed"
                await write_preference(
                    f"{update['status'].capitalize()} {slug}: {update['reason']}",
                    pattern_type,
                )
            return slug, None
        except Exception as e:
            return slug, str(e)

    results = await asyncio.gather(*[_update_one(u) for u in updates])
    updated = [slug for slug, err in results if err is None]
    errors = [f"{slug}: {err}" for slug, err in results if err is not None]
    return updated, errors


async def write_preferences_batch(items: list[dict]) -> tuple[int, list[str]]:
    """Write many preferences in parallel. Returns (saved_count, errors)."""

    async def _write_one(item: dict) -> str | None:
        try:
            await write_preference(item["pattern"], item.get("type", "approved"))
            return None
        except Exception as e:
            return str(e)

    results = await asyncio.gather(*[_write_one(item) for item in items])
    errors = [err for err in results if err is not None]
    return len(items) - len(errors), errors


async def list_startups() -> list[dict]:
    """Return lightweight records of every startup already in memory."""
    docs = await asyncio.to_thread(
        get_client().documents.list, container_tags=["vc:startups"]
    )
    out = []
    for doc in getattr(docs, "memories", []):
        meta = doc.metadata or {}
        out.append({
            "slug": getattr(doc, "custom_id", None) or "",
            "name": meta.get("name", ""),
            "website": meta.get("website", ""),
            "status": meta.get("status", "new"),
        })
    return out


async def known_startups_summary() -> str:
    """A compact list of already-seen startups, for deduping scout sweeps."""
    startups = await list_startups()
    if not startups:
        return "None yet."
    return "\n".join(
        f"- {s['name']} (slug: {s['slug']}, status: {s['status']})"
        for s in startups[:80]
        if s["name"] or s["slug"]
    )


async def known_startups_brief() -> str:
    """Name + website list for SMS context."""
    startups = await list_startups()
    if not startups:
        return "None yet."

    lines = []
    for s in startups[:80]:
        name = (s.get("name") or s.get("slug") or "").strip()
        if not name:
            continue
        website = (s.get("website") or "").strip()
        if website:
            website = website.removeprefix("https://").removeprefix("http://").rstrip("/")
            lines.append(f"- {name} ({website})")
        else:
            lines.append(f"- {name}")
    return "\n".join(lines) or "None yet."


async def update_startup_status(slug: str, status: str) -> str:
    docs = await asyncio.to_thread(
        get_client().documents.list, container_tags=["vc:startups"]
    )
    for doc in getattr(docs, "memories", []):
        if getattr(doc, "custom_id", None) == slug:
            meta = {**(doc.metadata or {}), "status": status}
            await asyncio.to_thread(
                lambda doc_id=doc.id, meta=meta: get_client().documents.update(
                    doc_id, metadata=meta
                )
            )
            return f"Updated {slug} to {status}"
    return f"Startup {slug} not found."


async def write_preference(pattern: str, pattern_type: str):
    h = hashlib.md5(pattern.encode()).hexdigest()[:8]
    await asyncio.to_thread(
        lambda: get_client().add(
            content=pattern,
            container_tag="vc:preferences",
            custom_id=f"{pattern_type}-{h}",
            metadata={"type": pattern_type},
            dreaming="dynamic",
        )
    )


async def write_reflection(reflection: str):
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await asyncio.to_thread(
        lambda: get_client().add(
            content=reflection,
            container_tag="vc:reflections",
            custom_id=f"reflection-{date}",
            dreaming="dynamic",
        )
    )


async def write_market_brief(brief: str, headline: str = "") -> str:
    """Save this week's market-intel digest to memory."""
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    title = headline.strip() or f"Weekly VC brief — {date}"
    content = f"# {title}\n\n{brief.strip()}"
    await asyncio.to_thread(
        lambda: get_client().add(
            content=content,
            container_tag="vc:market-intel",
            custom_id=f"brief-{date}",
            metadata={"date": date, "type": "weekly_brief"},
            dreaming="dynamic",
        )
    )
    return date


async def update_thesis(new_content: str):
    await asyncio.to_thread(
        lambda: get_client().add(
            content=new_content,
            container_tag="vc:thesis",
            custom_id="thesis",
            dreaming="instant",
        )
    )
