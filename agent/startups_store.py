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
        # No .limit() set — relies on PostgREST's default max_rows (commonly 1000).
        # Fine at current dealflow size; if this table ever grows past that, this
        # (and known_startups_summary/find_startups below) will need pagination.
        res = await asyncio.wait_for(
            asyncio.to_thread(lambda: sb.table("startups").select(columns).execute()),
            timeout=_SB_TIMEOUT,
        )
        return res.data or []
    except Exception as e:
        print("startups_store: failed to list startups:", e)
        return []


async def known_startups_summary() -> str:
    """Compact list of the most recently touched saved startups — injected into every
    prompt as a soft dedup hint and general sense of what's fresh. Not a tool itself
    (no on-demand equivalent — find_startups/query_startups cover live lookups).
    Queried live (no cache): this is the same store writes land in, so there's no
    staleness window to protect against.

    Capped and ordered by most-recently-updated first: at real dealflow size (hundreds
    of rows) this can NOT show everything within a reasonable prompt budget, so it's
    biased toward what's most likely to matter right now (a sweep just found something
    that looks like it might already be tracked) rather than an arbitrary DB-order
    slice. For "do we already know about X" on anything not in this list, use
    find_startups (one name) or query_startups (a whole matching set) — both are live
    searches over the full table, not subject to this cap."""
    sb = _sb_client()
    if sb is None:
        return "None yet."
    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: sb.table("startups")
                .select("name, slug, status")
                .order("updated_at", desc=True)
                .execute()
            ),
            timeout=_SB_TIMEOUT,
        )
        rows = res.data or []
    except Exception as e:
        print("startups_store: failed to list startups:", e)
        return "None yet."
    if not rows:
        return "None yet."
    lines = "\n".join(
        f"- {r.get('name', '')} (slug: {r.get('slug', '')}, status: {r.get('status', 'new')})"
        for r in rows
        if r.get("name") or r.get("slug")
    )
    total = len(rows)
    truncated = sm.truncate_text(lines, 6000)
    if truncated.endswith("…"):
        truncated += f"\n[showing the most recently updated of {total} total — use find_startups to search the rest]"
    return truncated


async def find_startups(query: str, limit: int = 15) -> str:
    """Live substring search over the full startups table (name or one-liner,
    case-insensitive) — not subject to known_startups_summary's cap, so this is how
    the agent finds something that isn't in the recently-updated slice it sees by
    default. This is the actual fix for dealflow lookups silently missing rows once
    there are more startups than fit in a prompt-sized summary."""
    sb = _sb_client()
    if sb is None:
        return "[Supabase not configured]"
    query = (query or "").strip()
    if not query:
        return "No query provided."
    like = f"%{query}%"
    try:
        res = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: sb.table("startups")
                .select("name, slug, status, one_liner")
                .or_(f"name.ilike.{like},one_liner.ilike.{like}")
                .limit(limit)
                .execute()
            ),
            timeout=_SB_TIMEOUT,
        )
        rows = res.data or []
    except Exception as e:
        return f"[search failed: {e}]"
    if not rows:
        return f"No startups matching '{query}'."
    return "\n".join(
        f"- {r.get('name', '')} (slug: {r.get('slug', '')}, status: {r.get('status', 'new')})"
        f"{': ' + r['one_liner'] if r.get('one_liner') else ''}"
        for r in rows
    )


_QUERY_PAGE_MAX = 100  # hard cap per call so one tool result can't blow up context


async def query_startups(
    status: str | None = None,
    stealth: bool | None = None,
    linkedin_status: str | None = None,
    email_status: str | None = None,
    offset: int = 0,
    limit: int = 40,
) -> str:
    """Structured, paginated scan over the full startups table — how to enumerate
    dealflow matching real criteria ("every approved non-stealth startup not yet
    emailed") without ever pulling the whole table into one tool call. Returns up to
    `limit` rows starting at `offset`, ordered by most-recently-updated, plus how many
    total rows matched. If more remain, the caller (the model) is expected to call
    this again with offset advanced by the number of rows just returned — repeat
    until the running total covers every match, not just the first page, whenever the
    boss actually wants the full list rather than a sample."""
    sb = _sb_client()
    if sb is None:
        return "[Supabase not configured]"
    limit = max(1, min(limit, _QUERY_PAGE_MAX))
    offset = max(0, offset)
    try:
        q = sb.table("startups").select(
            "name, slug, status, stealth, linkedin_status, email_status",
            count="exact",
        )
        if status is not None:
            q = q.eq("status", status)
        if stealth is not None:
            q = q.eq("stealth", stealth)
        if linkedin_status is not None:
            q = q.eq("linkedin_status", linkedin_status)
        if email_status is not None:
            q = q.eq("email_status", email_status)
        q = q.order("updated_at", desc=True).range(offset, offset + limit - 1)
        res = await asyncio.wait_for(asyncio.to_thread(lambda: q.execute()), timeout=_SB_TIMEOUT)
        rows = res.data or []
        total = res.count if res.count is not None else len(rows)
    except Exception as e:
        return f"[query failed: {e}]"

    if not rows:
        return "No matches." if offset == 0 else "No more matches at this offset."

    lines = "\n".join(
        f"- {r.get('name', '')} (slug: {r.get('slug', '')}, status: {r.get('status', 'new')}, "
        f"stealth: {r.get('stealth')}, linkedin: {r.get('linkedin_status')}, email: {r.get('email_status')})"
        for r in rows
    )
    next_offset = offset + len(rows)
    remaining = total - next_offset
    footer = f"\n[{next_offset}/{total} matched shown]"
    if remaining > 0:
        footer = f"\n[{next_offset}/{total} matched shown — {remaining} more, call again with offset={next_offset} to continue]"
    return lines + footer


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
