"""Dealflow storage — startups live directly in Supabase, read and written live.

This replaces the old Supermemory-backed dealflow functions in memory_store.py.
Supermemory is no longer touched for startups at all; it's still used (via
memory_store.py) for the investment thesis, learned preferences, and reflections.

The agent can only ever add startups (always status="new") or delete them — it has
no tool to change status. Approve/pass now happens exclusively on the dashboard
(src/app/api/startup/[slug]/route.ts and src/app/api/startups/route.ts write status
directly, no agent involvement), a deliberate decision so a chat message can never
be mistaken for a status-change instruction.

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


def _looks_stealth(name: str) -> bool:
    """Auto-flag a startup as stealth if its name literally says so (e.g. "Acme Stealth
    AI", "Jane Doe Stealth Health") — a common pattern for signals sourced before a
    company has a real public name. Only sets stealth=True on save; never unsets it,
    so a boss manually un-marking one on the dashboard later isn't fought by this."""
    return "stealth" in (name or "").lower()


def _normalize_name(name: str) -> str:
    """Collapse a startup name to bare alnum for duplicate matching (e.g. 'Acme, Inc.'
    and 'acme-ai' both normalize to comparable forms) — case/punctuation/spacing shouldn't
    let the same company get saved twice under a different slug."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


_LIST_PAGE_SIZE = 1000  # PostgREST's own default max_rows — page in chunks of this
# size so a table larger than one page still gets read in full, instead of the old
# unpaginated .select() silently truncating at the first ~1000 rows with no signal
# that it had. This is what makes save_startups_batch's dedup and crosscheck_startups
# below actually cover the FULL table, not just however much fit in one response.


async def _list_raw(columns: str = "slug, name, status") -> list[dict]:
    """Raises on failure instead of swallowing it — callers that need a real answer
    (crosscheck_startups) must be able to tell "the table has zero matches" apart
    from "the fetch failed partway through," since silently treating a failed fetch
    as an empty table would make every candidate look confirmed-new and duplicate
    saves would sail right through."""
    sb = _sb_client()
    if sb is None:
        raise RuntimeError("Supabase not configured")
    rows: list[dict] = []
    offset = 0
    while True:
        res = await asyncio.wait_for(
            asyncio.to_thread(
                lambda offset=offset: sb.table("startups")
                .select(columns)
                .range(offset, offset + _LIST_PAGE_SIZE - 1)
                .execute()
            ),
            timeout=_SB_TIMEOUT,
        )
        page = res.data or []
        rows.extend(page)
        if len(page) < _LIST_PAGE_SIZE:
            break
        offset += _LIST_PAGE_SIZE
    return rows


async def known_startups_summary() -> str:
    """Compact list of the most recently touched saved startups — injected into every
    prompt as a soft dedup hint and general sense of what's fresh. Not a tool itself
    (no on-demand equivalent — crosscheck_startups/query_startups cover live lookups).
    Queried live (no cache): this is the same store writes land in, so there's no
    staleness window to protect against.

    Capped and ordered by most-recently-updated first: at real dealflow size (hundreds
    of rows) this can NOT show everything within a reasonable prompt budget, so it's
    biased toward what's most likely to matter right now (a sweep just found something
    that looks like it might already be tracked) rather than an arbitrary DB-order
    slice. This is a hint, never proof of absence — for "do we already know about X"
    (on one name or a whole batch of sourced candidates), use crosscheck_startups,
    which checks the FULL table with an exact normalized-name match, not this capped
    slice and not a fuzzy text search."""
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
        truncated += f"\n[showing the most recently updated of {total} total — use crosscheck_startups to check the rest]"
    return truncated


async def crosscheck_startups(names: list[str]) -> str:
    """Batch existence check across the FULL startups table — one call, any number of
    candidate names. Replaces the old find_startups substring search, which matched
    loosely against BOTH name and one_liner text: a candidate whose name merely
    shared a word with some unrelated startup's one-liner would come back as a "hit,"
    which is exactly how the agent ended up convinced brand-new companies were
    already tracked. This uses the same normalized-name comparison (lowercased,
    punctuation/spacing stripped) that save_startups_batch itself uses to decide
    what to skip — so a "not found" here is a real guarantee, not a fuzzy guess, and
    always agrees with what save_startups will actually do with that name.

    Pass every candidate in ONE call (a one-element list is fine for a single name)
    — never loop calling this once per name."""
    names = [n.strip() for n in (names or []) if n and n.strip()]
    if not names:
        return "No names provided."
    sb = _sb_client()
    if sb is None:
        return "[Supabase not configured]"
    try:
        existing = await _list_raw("slug, name, status")
    except Exception as e:
        return f"[crosscheck failed: {e}]"

    existing_by_name: dict[str, dict] = {}
    for r in existing:
        if r.get("name"):
            existing_by_name.setdefault(_normalize_name(r["name"]), r)

    lines = []
    for name in names:
        match = existing_by_name.get(_normalize_name(name))
        if match:
            lines.append(
                f"- {name}: ALREADY IN DEALFLOW as '{match['slug']}' "
                f"(status: {match.get('status', 'new')}) — do not save this one"
            )
        else:
            lines.append(f"- {name}: not found — confirmed new, safe to save")
    return "\n".join(lines)


_QUERY_PAGE_MAX = 100  # hard cap per call so one tool result can't blow up context


async def query_startups(
    status: str | None = None,
    stealth: bool | None = None,
    linkedin_status: str | None = None,
    email_status: str | None = None,
    followed_up: bool | None = None,
    offset: int = 0,
    limit: int = 40,
) -> str:
    """Structured, paginated scan over the full startups table — how to enumerate
    dealflow matching real criteria ("every approved startup we've never followed
    up with", "every approved non-stealth startup not yet emailed") without ever pulling the whole table into one tool call. Returns up to
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
            "name, slug, status, stealth, linkedin_status, email_status, "
            "followup_count, last_followup_at",
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
        # followup_count is a counter, not an enum — "have we followed up" is
        # count > 0, so the boolean filter maps onto that rather than a status value.
        if followed_up is not None:
            q = q.gt("followup_count", 0) if followed_up else q.eq("followup_count", 0)
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
        f"stealth: {r.get('stealth')}, linkedin: {r.get('linkedin_status')}, "
        f"email: {r.get('email_status')}, follow-ups: {r.get('followup_count') or 0}"
        + (f" (last {str(r.get('last_followup_at'))[:10]})" if r.get("last_followup_at") else "")
        + ")"
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
    Returns (saved_slugs, skipped_messages, errors).

    Fails closed if the existing-startups listing itself fails: better to save
    nothing and report the error than to silently insert with no dedup check
    (which used to be exactly what happened on a listing hiccup)."""
    try:
        existing = await _list_raw("slug, name, status")
    except Exception as e:
        return [], [], [f"{item['name']}: dedup check failed, nothing saved ({e})" for item in items]
    existing_by_name = {_normalize_name(r["name"]): r for r in existing if r.get("name")}
    existing_by_slug = {r["slug"]: r for r in existing if r.get("slug")}

    to_insert = []
    skipped = []
    # slug is a Postgres primary key, so two items in the SAME batch sharing a slug
    # (the model surfacing one company twice from different search queries in one
    # sweep) would otherwise both reach the single batched .insert() below and blow
    # up the whole call on a unique-violation — failing every item in the batch, not
    # just the duplicate. Track what's already staged for insert this call, same as
    # existing_by_slug/existing_by_name track what's already in the DB.
    batch_slugs: set[str] = set()
    batch_names: set[str] = set()
    for item in items:
        slug = item["slug"]
        norm_name = _normalize_name(item["name"])
        match = existing_by_slug.get(slug) or existing_by_name.get(norm_name)
        if match:
            skipped.append(
                f"{item['name']}: already known as '{match['slug']}' "
                f"(status: {match.get('status', 'new')}) — not re-saved"
            )
            continue
        if slug in batch_slugs or norm_name in batch_names:
            skipped.append(
                f"{item['name']}: duplicate within this batch (slug '{slug}') — only the first occurrence was saved"
            )
            continue
        batch_slugs.add(slug)
        batch_names.add(norm_name)
        now = datetime.now(timezone.utc)
        row = {
            "slug": slug,
            "name": item["name"],
            "website": item.get("website") or "",
            "one_liner": item["one_liner"],
            "assessment": item["assessment"],
            "signal_urls": item.get("signal_urls") or [],
            "status": "new",
            "stealth": _looks_stealth(item["name"]),
            "found_date": now.strftime("%Y-%m-%d"),
            "updated_at": now.isoformat(),
        }
        # Only set on stealth saves where the sweep already researched the founder(s) —
        # see agent.py's stealth founder research rule. Absent/empty otherwise, so the
        # column keeps its normal '[]' default for the common (non-stealth) case.
        founders = item.get("founders")
        if founders:
            row["founders"] = founders
        to_insert.append(row)

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
