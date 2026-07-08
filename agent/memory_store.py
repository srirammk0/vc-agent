import asyncio
import hashlib
import os
from datetime import datetime, timezone

from supermemory import Supermemory

try:
    import cache as _cache_mod
except ImportError:
    _cache_mod = None

_STARTUP_LIST_TTL = 5 * 60  # 5 minutes — short enough to reflect new saves within a run

_client = None
_SM_TIMEOUT = 30.0


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
        res = await asyncio.wait_for(
            asyncio.to_thread(
                get_client().search.memories,
                q="investment thesis criteria",
                container_tag="vc:thesis",
                limit=1,
            ),
            timeout=_SM_TIMEOUT,
        )
        results = getattr(res, "results", [])
        if results:
            return truncate_text(_result_text(results[0]) or "No thesis configured.", 3500)
    except Exception as e:
        print("Failed to load thesis from Supermemory:", e)
    return "No thesis configured."


async def load_preferences() -> str:
    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(
                get_client().search.memories,
                q="startup patterns preferences",
                container_tag="vc:preferences",
                limit=20,
            ),
            timeout=_SM_TIMEOUT,
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
        res = await asyncio.wait_for(
            asyncio.to_thread(
                get_client().search.memories,
                q=query,
                container_tag=container_tag,
                search_mode="hybrid",
                limit=limit,
            ),
            timeout=_SM_TIMEOUT,
        )
        results = getattr(res, "results", [])
        joined = "\n---\n".join(_result_text(r) for r in results if _result_text(r))
        return joined or "No results."
    except Exception as e:
        return f"[MEMORY UNAVAILABLE: {e} — proceed without memory context]"


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
    await asyncio.wait_for(
        asyncio.to_thread(
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
            )
        ),
        timeout=_SM_TIMEOUT,
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
    if saved:
        await _bust_list_cache()
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
    if updated:
        await _bust_list_cache()
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


_LIST_CACHE_KEY = "sm:startups:list"


async def list_startups() -> list[dict]:
    """Return all startups from memory. Result is cached for 5 minutes."""
    if _cache_mod:
        cached = await _cache_mod.cache_get(_LIST_CACHE_KEY, _STARTUP_LIST_TTL)
        if cached is not None:
            return cached

    docs = await asyncio.wait_for(
        asyncio.to_thread(
            lambda: get_client().documents.list(
                container_tags=["vc:startups"],
                limit=500,
            )
        ),
        timeout=_SM_TIMEOUT,
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

    if _cache_mod and out:
        await _cache_mod.cache_set(_LIST_CACHE_KEY, out)
    return out


async def _bust_list_cache() -> None:
    if _cache_mod:
        await _cache_mod.cache_delete(_LIST_CACHE_KEY)


async def known_startups_summary() -> str:
    """Compact list of all saved startups with slug and status, for agent deduplication."""
    try:
        startups = await list_startups()
    except Exception:
        return "None yet."
    if not startups:
        return "None yet."
    return "\n".join(
        f"- {s['name']} (slug: {s['slug']}, status: {s['status']})"
        for s in startups
        if s["name"] or s["slug"]
    )


async def _find_doc(container_tag: str, custom_id: str):
    """Look up a document by custom_id within a container. Returns the doc or None."""
    docs = await asyncio.wait_for(
        asyncio.to_thread(
            get_client().documents.list, container_tags=[container_tag]
        ),
        timeout=_SM_TIMEOUT,
    )
    for doc in getattr(docs, "memories", []):
        if getattr(doc, "custom_id", None) == custom_id:
            return doc
    return None


def _sb_client():
    try:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or ""
        if url and key:
            return create_client(url, key)
    except Exception:
        pass
    return None


async def update_startup_status(slug: str, status: str) -> str:
    doc = await _find_doc("vc:startups", slug)
    if doc is None:
        return f"Startup {slug} not found in memory."

    meta = {**(doc.metadata or {}), "status": status}
    await asyncio.wait_for(
        asyncio.to_thread(
            lambda: get_client().documents.update(doc.id, metadata=meta)
        ),
        timeout=_SM_TIMEOUT,
    )

    # Mirror immediately to Supabase so the dashboard reflects the change without
    # waiting for the next scheduled sync.
    try:
        sb = _sb_client()
        if sb:
            updated_at = datetime.now(timezone.utc).isoformat()
            await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: sb.table("startups")
                    .update({"status": status, "updated_at": updated_at})
                    .eq("slug", slug)
                    .execute()
                ),
                timeout=10.0,
            )
    except Exception as e:
        print(f"Supabase status mirror failed for {slug}:", e)

    return f"Updated {slug} to {status}"


async def delete_startup(slug: str) -> str:
    doc = await _find_doc("vc:startups", slug)
    if doc is None:
        return f"Startup {slug} not found in memory."

    await asyncio.wait_for(
        asyncio.to_thread(get_client().documents.delete, doc.id),
        timeout=_SM_TIMEOUT,
    )

    # Mirror immediately to Supabase so the dashboard stops showing it without
    # waiting for the next scheduled sync.
    try:
        sb = _sb_client()
        if sb:
            await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: sb.table("startups").delete().eq("slug", slug).execute()
                ),
                timeout=10.0,
            )
    except Exception as e:
        print(f"Supabase delete mirror failed for {slug}:", e)

    return f"Deleted {slug}"


async def delete_startups_batch(slugs: list[str]) -> tuple[list[str], list[str]]:
    """Delete many startups in parallel. Returns (deleted_slugs, errors)."""

    async def _delete_one(slug: str) -> tuple[str, str | None]:
        try:
            msg = await delete_startup(slug)
            if "not found" in msg.lower():
                return slug, msg
            return slug, None
        except Exception as e:
            return slug, str(e)

    results = await asyncio.gather(*[_delete_one(s) for s in slugs])
    deleted = [slug for slug, err in results if err is None]
    errors = [f"{slug}: {err}" for slug, err in results if err is not None]
    if deleted:
        await _bust_list_cache()
    return deleted, errors


async def write_preference(pattern: str, pattern_type: str):
    h = hashlib.md5(pattern.encode()).hexdigest()[:8]
    await asyncio.wait_for(
        asyncio.to_thread(
            lambda: get_client().add(
                content=pattern,
                container_tag="vc:preferences",
                custom_id=f"{pattern_type}-{h}",
                metadata={"type": pattern_type},
            )
        ),
        timeout=_SM_TIMEOUT,
    )


async def list_preferences() -> str:
    """List all saved seek/avoid patterns with their IDs, so a bad one can be targeted for deletion."""
    docs = await asyncio.wait_for(
        asyncio.to_thread(
            get_client().documents.list,
            container_tags=["vc:preferences"],
            include_content=True,
        ),
        timeout=_SM_TIMEOUT,
    )
    lines = []
    for doc in getattr(docs, "memories", []):
        pid = getattr(doc, "custom_id", None) or doc.id
        meta = doc.metadata or {}
        content = (getattr(doc, "content", "") or "").strip()
        lines.append(f"- [{pid}] ({meta.get('type', '?')}) {content}")
    return "\n".join(lines) if lines else "No preferences saved yet."


async def delete_preference(pattern_id: str) -> str:
    doc = await _find_doc("vc:preferences", pattern_id)
    if doc is None:
        return f"Preference {pattern_id} not found in memory."
    await asyncio.wait_for(
        asyncio.to_thread(get_client().documents.delete, doc.id),
        timeout=_SM_TIMEOUT,
    )
    return f"Deleted preference {pattern_id}"


async def delete_preferences_batch(pattern_ids: list[str]) -> tuple[list[str], list[str]]:
    """Delete many preferences in parallel. Returns (deleted_ids, errors)."""

    async def _delete_one(pid: str) -> tuple[str, str | None]:
        try:
            msg = await delete_preference(pid)
            if "not found" in msg.lower():
                return pid, msg
            return pid, None
        except Exception as e:
            return pid, str(e)

    results = await asyncio.gather(*[_delete_one(p) for p in pattern_ids])
    deleted = [pid for pid, err in results if err is None]
    errors = [f"{pid}: {err}" for pid, err in results if err is not None]
    return deleted, errors


async def write_reflection(reflection: str, source: str):
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await asyncio.wait_for(
        asyncio.to_thread(
            lambda: get_client().add(
                content=reflection,
                container_tag="vc:reflections",
                custom_id=f"reflection-{source}-{date}",
                metadata={"source": source, "date": date},
            )
        ),
        timeout=_SM_TIMEOUT,
    )


async def load_recent_reflection(source: str) -> str:
    """Latest reflection written by a given source (e.g. 'news', 'text') — used to give
    the SMS agent visibility into what other autonomous processes have been doing."""
    try:
        docs = await asyncio.wait_for(
            asyncio.to_thread(
                get_client().documents.list,
                container_tags=["vc:reflections"],
                include_content=True,
            ),
            timeout=_SM_TIMEOUT,
        )
        matches = [
            d for d in getattr(docs, "memories", [])
            if (d.metadata or {}).get("source") == source
        ]
        if not matches:
            return "No reflections yet."
        matches.sort(key=lambda d: (d.metadata or {}).get("date", ""), reverse=True)
        content = (getattr(matches[0], "content", "") or "").strip()
        return truncate_text(content, 1200) or "No reflections yet."
    except Exception as e:
        print(f"Failed to load {source} reflection from Supermemory:", e)
        return "No reflections yet."


async def update_thesis(new_content: str):
    await asyncio.wait_for(
        asyncio.to_thread(
            lambda: get_client().add(
                content=new_content,
                container_tag="vc:thesis",
                custom_id="thesis",
            )
        ),
        timeout=_SM_TIMEOUT,
    )
