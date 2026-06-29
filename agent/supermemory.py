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
            return _result_text(results[0]) or "No thesis configured."
    except Exception as e:
        print("Failed to load thesis from Supermemory:", e)
    return "No thesis configured."


async def load_preferences() -> str:
    try:
        res = await asyncio.to_thread(
            get_client().search.memories,
            q="startup patterns preferences",
            container_tag="vc:preferences",
            limit=50,
        )
        results = getattr(res, "results", [])
        if results:
            return "\n".join(_result_text(r) for r in results if _result_text(r))
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


async def update_thesis(new_content: str):
    await asyncio.to_thread(
        lambda: get_client().add(
            content=new_content,
            container_tag="vc:thesis",
            custom_id="thesis",
            dreaming="instant",
        )
    )
