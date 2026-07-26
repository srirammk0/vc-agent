import asyncio
import hashlib
import re
import time
from datetime import datetime, timezone

from supermemory import NotFoundError, Supermemory

try:
    import cache as _cache_mod
except ImportError:
    _cache_mod = None

_THESIS_TTL = 5 * 60  # boss-initiated only
_PREFERENCES_TTL = 5 * 60

_THESIS_CACHE_KEY = "sm:thesis"
_PREFERENCES_CACHE_KEY = "sm:preferences"

_client = None
_SM_TIMEOUT = 30.0

# Process-local layer in front of the Supabase-backed cache, for thesis/preferences
# only. load_thesis/load_preferences run on EVERY agent turn (assistant_instructions
# calls both, unconditionally, for every SMS reply, web chat message, and scheduled
# run) — that's a guaranteed 2 Supabase round-trips per turn for a value that changes
# only on a deliberate boss-initiated write. Modal keeps a container warm
# (min_containers=1), so most of those round-trips can be served from memory instead.
#
# Deliberately scoped to just these two keys, not the generic cache.py module: this
# doesn't change staleness bounds (still the same 5-minute TTL, same
# _bust_*_cache-on-write invalidation, which now also clears the local copy) — it
# only cuts network calls for a value that's read constantly and written rarely.
# Conversation history intentionally stays out of this: two concurrent containers
# racing on the same phone number's history need the Supabase row as the single
# source of truth, and a per-container memory cache there could drop a message.
_local_cache: dict[str, tuple[float, str]] = {}


def _local_get(key: str) -> str | None:
    entry = _local_cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() >= expires_at:
        _local_cache.pop(key, None)
        return None
    return value


def _local_set(key: str, value: str, ttl_seconds: int) -> None:
    _local_cache[key] = (time.monotonic() + ttl_seconds, value)


def _local_delete(key: str) -> None:
    _local_cache.pop(key, None)


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
    """Boss-initiated changes only (update_thesis) — cached for 5 minutes so every
    agent turn doesn't round-trip Supermemory for something that almost never changes.
    update_thesis busts this cache on write.

    Checks the process-local cache before the Supabase-backed one — see
    _local_cache's docstring above. Falls through to the network on a local miss,
    same as before this layer existed."""
    local = _local_get(_THESIS_CACHE_KEY)
    if local is not None:
        return local
    if _cache_mod:
        cached = await _cache_mod.cache_get(_THESIS_CACHE_KEY, _THESIS_TTL)
        if cached is not None:
            _local_set(_THESIS_CACHE_KEY, cached, _THESIS_TTL)
            return cached
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
        text = truncate_text(_result_text(results[0]) or "No thesis configured.", 3500) if results else "No thesis configured."
        _local_set(_THESIS_CACHE_KEY, text, _THESIS_TTL)
        if _cache_mod:
            await _cache_mod.cache_set(_THESIS_CACHE_KEY, text)
        return text
    except Exception as e:
        print("Failed to load thesis from Supermemory:", e)
    return "No thesis configured."


async def load_preferences() -> str:
    """Same 5-minute cache as load_thesis — preferences only change via
    write_preference/delete_preference, both of which bust this cache on write.

    Fetches the full preference list via documents.list rather than a similarity
    search — a fixed-query semantic search capped at N results silently drops
    preferences that happen to score low against that generic query once there are
    more than a handful saved, which is exactly the kind of thing that should never
    silently vanish from context (a "don't touch fintech" rule needs to show up every
    time, not just when it's semantically close to "startup patterns preferences").

    Checks the process-local cache before the Supabase-backed one — see
    _local_cache's docstring above load_thesis."""
    local = _local_get(_PREFERENCES_CACHE_KEY)
    if local is not None:
        return local
    if _cache_mod:
        cached = await _cache_mod.cache_get(_PREFERENCES_CACHE_KEY, _PREFERENCES_TTL)
        if cached is not None:
            _local_set(_PREFERENCES_CACHE_KEY, cached, _PREFERENCES_TTL)
            return cached
    try:
        docs = await asyncio.wait_for(
            asyncio.to_thread(
                get_client().documents.list,
                container_tags=["vc:preferences"],
                include_content=True,
                limit=200,
            ),
            timeout=_SM_TIMEOUT,
        )
        lines = []
        for doc in getattr(docs, "memories", []):
            content = (getattr(doc, "content", "") or "").strip()
            if not content:
                continue
            meta = doc.metadata or {}
            lines.append(f"- ({meta.get('type', '?')}) {content}")
        text = truncate_text("\n".join(lines), 3000) if lines else "No preferences yet."
        _local_set(_PREFERENCES_CACHE_KEY, text, _PREFERENCES_TTL)
        if _cache_mod:
            await _cache_mod.cache_set(_PREFERENCES_CACHE_KEY, text)
        return text
    except Exception as e:
        print("Failed to load preferences from Supermemory:", e)
    return "No preferences yet."


async def _bust_thesis_cache() -> None:
    _local_delete(_THESIS_CACHE_KEY)
    if _cache_mod:
        await _cache_mod.cache_delete(_THESIS_CACHE_KEY)


async def _bust_preferences_cache() -> None:
    _local_delete(_PREFERENCES_CACHE_KEY)
    if _cache_mod:
        await _cache_mod.cache_delete(_PREFERENCES_CACHE_KEY)


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


def _normalize_pattern(text: str) -> str:
    """Collapse case/punctuation/whitespace differences before hashing a preference's
    custom_id, so restating the same rule ("avoid fintech" vs "Avoid fintech.") reinforces
    the same memory doc instead of silently creating a near-duplicate entry that bloats
    the preference list and pushes older entries further from view."""
    text = re.sub(r"[^\w\s]", "", (text or "").lower())
    return re.sub(r"\s+", " ", text).strip()


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


async def write_preference(pattern: str, pattern_type: str):
    h = hashlib.md5(_normalize_pattern(pattern).encode()).hexdigest()[:8]
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
    await _bust_preferences_cache()


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
    try:
        await asyncio.wait_for(
            asyncio.to_thread(get_client().documents.delete, pattern_id),
            timeout=_SM_TIMEOUT,
        )
    except NotFoundError:
        return f"Preference {pattern_id} not found in memory."
    await _bust_preferences_cache()
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
    await _bust_thesis_cache()
