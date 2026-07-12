"""Dealflow storage — startups live directly in Supabase, read and written live.

This replaces the old Supermemory-backed dealflow functions in memory_store.py.
Supermemory is no longer touched for startups at all; it's still used (via
memory_store.py) for the investment thesis, learned preferences, and
reflections, which this module calls into only for the preference side-effect
on update_startup_statuses_batch (an approve/pass with a reason still teaches
a reusable pattern).

No caching layer here (unlike the old 5-minute Supermemory list cache) —
reads and writes now hit the same store, so a cache would just reintroduce
staleness for no benefit; Supabase is fast enough to query live every turn.
"""

import asyncio
import os
import re
from datetime import datetime, timezone

from supabase import create_client

import memory_store as sm

_SB_TIMEOUT = 15.0


def _sb_client():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    return create_client(url, key)


def _normalize_name(name: str) -> str:
    """Collapse a startup name to bare alnum for duplicate matching (e.g. 'Acme, Inc.'
    and 'acme-ai' both normalize to comparable forms) — case/punctuation/spacing shouldn't
    let the same company get saved twice under a different slug."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


async def _list_raw(columns: str = "slug, name, status") -> list[dict]:
    sb = _sb_client()
    if sb is None:
        return []
    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(lambda: sb.table("startups").select(columns).execute()),
            timeout=_SB_TIMEOUT,
        )
        return res.data or []
    except Exception as e:
        print("startups_store: failed to list startups:", e)
        return []


async def known_startups_summary() -> str:
    """Compact list of all saved startups with slug and status — injected into every
    prompt as a soft dedup hint, and what the list_known_startups tool returns on demand.
    Queried live (no cache): this is the same store writes land in, so there's no
    staleness window to protect against. Capped so this doesn't grow unbounded as
    dealflow accumulates — safe to truncate because it's only a hint, not the dedup
    guarantee itself: save_startups_batch always re-checks the full list server-side
    regardless of what's in this text."""
    rows = await _list_raw("name, slug, status")
    if not rows:
        return "None yet."
    lines = "\n".join(
        f"- {r.get('name', '')} (slug: {r.get('slug', '')}, status: {r.get('status', 'new')})"
        for r in rows
        if r.get("name") or r.get("slug")
    )
    return sm.truncate_text(lines, 4000)


async def save_startups_batch(
    items: list[dict],
) -> tuple[list[str], list[str], list[str]]:
    """Save many startups in one batched insert, skipping any already known (by
    normalized name or slug) instead of silently re-saving/duplicating them.
    Returns (saved_slugs, skipped_messages, errors)."""
    existing = await _list_raw("slug, name, status")
    existing_by_name = {_normalize_name(r["name"]): r for r in existing if r.get("name")}
    existing_by_slug = {r["slug"]: r for r in existing if r.get("slug")}

    to_insert = []
    skipped = []
    for item in items:
        slug = item["slug"]
        match = existing_by_slug.get(slug) or existing_by_name.get(_normalize_name(item["name"]))
        if match:
            skipped.append(
                f"{item['name']}: already known as '{match['slug']}' "
                f"(status: {match.get('status', 'new')}) — not re-saved"
            )
            continue
        now = datetime.now(timezone.utc)
        to_insert.append({
            "slug": slug,
            "name": item["name"],
            "website": item.get("website") or "",
            "one_liner": item["one_liner"],
            "assessment": item["assessment"],
            "signal_urls": item.get("signal_urls") or [],
            "status": "new",
            "found_date": now.strftime("%Y-%m-%d"),
            "updated_at": now.isoformat(),
        })

    if not to_insert:
        return [], skipped, []

    sb = _sb_client()
    if sb is None:
        return [], skipped, [f"{r['slug']}: Supabase not configured" for r in to_insert]

    try:
        await asyncio.wait_for(
            asyncio.to_thread(lambda: sb.table("startups").insert(to_insert).execute()),
            timeout=_SB_TIMEOUT,
        )
        return [r["slug"] for r in to_insert], skipped, []
    except Exception as e:
        return [], skipped, [f"{r['slug']}: {e}" for r in to_insert]


async def update_startup_statuses_batch(
    updates: list[dict],
) -> tuple[list[str], list[str]]:
    """Update many startup statuses in parallel, direct Supabase writes. When a reason
    is given, also writes a learned preference to Supermemory (unchanged behavior —
    preferences stay in Supermemory, only the status write itself moved to Supabase).
    Returns (updated_slugs, errors)."""
    sb = _sb_client()
    if sb is None:
        return [], [f"{u['slug']}: Supabase not configured" for u in updates]

    async def _update_one(u: dict) -> tuple[str, str | None]:
        slug = u["slug"]
        status = u["status"]
        try:
            res = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: sb.table("startups")
                    .update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
                    .eq("slug", slug)
                    .execute()
                ),
                timeout=_SB_TIMEOUT,
            )
            if not res.data:
                return slug, "not found"
            if u.get("reason"):
                pattern_type = "approved" if status == "approved" else "passed"
                await sm.write_preference(f"{status.capitalize()} {slug}: {u['reason']}", pattern_type)
            return slug, None
        except Exception as e:
            return slug, str(e)

    results = await asyncio.gather(*[_update_one(u) for u in updates])
    updated = [slug for slug, err in results if err is None]
    errors = [f"{slug}: {err}" for slug, err in results if err is not None]
    return updated, errors


async def delete_startups_batch(slugs: list[str]) -> tuple[list[str], list[str]]:
    """Permanently delete many startups in parallel. Returns (deleted_slugs, errors)."""
    sb = _sb_client()
    if sb is None:
        return [], [f"{s}: Supabase not configured" for s in slugs]

    async def _delete_one(slug: str) -> tuple[str, str | None]:
        try:
            res = await asyncio.wait_for(
                asyncio.to_thread(lambda: sb.table("startups").delete().eq("slug", slug).execute()),
                timeout=_SB_TIMEOUT,
            )
            if not res.data:
                return slug, "not found"
            return slug, None
        except Exception as e:
            return slug, str(e)

    results = await asyncio.gather(*[_delete_one(s) for s in slugs])
    deleted = [slug for slug, err in results if err is None]
    errors = [f"{slug}: {err}" for slug, err in results if err is not None]
    return deleted, errors
