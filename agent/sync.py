import os
import re
import datetime

from supermemory import Supermemory
from supabase import create_client


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _extract_field(content: str, label: str) -> str:
    for line in (content or "").splitlines():
        if line.startswith(f"{label}:"):
            return line.replace(f"{label}:", "").strip()
    return ""


def _extract_assessment(content: str) -> str:
    value = _extract_field(content, "Assessment")
    if value:
        return value
    return content[:300] if content else ""


def _extract_signal_urls(content: str) -> list[str]:
    raw = _extract_field(content, "Signal URLs")
    if not raw:
        return []
    return [u.strip() for u in raw.split(",") if u.strip()]


def sync():
    """Mirror the agent's Supermemory state into Supabase for the dashboard to read.

    The dashboard owns `status` and all enrichment columns. For startups that
    already exist in Supabase we only refresh agent-owned content fields, so a
    dashboard approve/pass is never clobbered by a later sync.
    """
    sm = Supermemory()
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    existing = sb.table("startups").select("slug").execute()
    existing_slugs = {row["slug"] for row in (existing.data or [])}

    docs = sm.documents.list(container_tags=["vc:startups"], include_content=True, limit=500)
    sm_slugs = set()
    update_rows = []
    insert_rows = []
    for doc in getattr(docs, "memories", []):
        meta = doc.metadata or {}
        content = getattr(doc, "content", "") or ""
        slug = getattr(doc, "custom_id", None) or re.sub(
            r"[^a-z0-9]+", "-", (meta.get("name") or "").lower()
        ).strip("-")
        if not slug:
            continue
        sm_slugs.add(slug)

        # Agent-owned content fields, always safe to refresh.
        content_fields = {
            "name": meta.get("name", "") or _extract_field(content, "Name"),
            "website": meta.get("website") or _extract_field(content, "Website"),
            "one_liner": meta.get("one_liner", "") or _extract_field(content, "One-liner"),
            "assessment": _extract_assessment(content),
            "signal_urls": _extract_signal_urls(content),
        }

        if slug in existing_slugs:
            update_rows.append({"slug": slug, **content_fields})
        else:
            insert_rows.append({
                "slug": slug,
                "status": meta.get("status", "new"),
                "found_date": meta.get("found_date"),
                "updated_at": _now(),
                **content_fields,
            })

    # Batched upsert for existing rows, content fields only — merge-duplicates upsert
    # only writes the columns present in each payload, so status/enrichment columns
    # (owned by the dashboard/agent-mirror, not listed here) are left untouched on
    # conflict, same guarantee the old per-row .update() gave.
    if update_rows:
        sb.table("startups").upsert(update_rows, on_conflict="slug").execute()
    if insert_rows:
        sb.table("startups").insert(insert_rows).execute()

    # Supermemory is the source of truth: rows that exist in Supabase but are no
    # longer in Supermemory (e.g. deleted via delete_startups) are orphans — drop them.
    orphan_slugs = existing_slugs - sm_slugs
    if orphan_slugs:
        sb.table("startups").delete().in_("slug", list(orphan_slugs)).execute()

    # Sync thesis too
    thesis_docs = sm.documents.list(container_tags=["vc:thesis"], include_content=True)
    thesis_memories = getattr(thesis_docs, "memories", [])
    if thesis_memories:
        content = getattr(thesis_memories[0], "content", "")
        if content:
            sb.table("thesis").upsert({
                "id": 1,
                "content": content,
                "updated_at": _now(),
            }).execute()


if __name__ == "__main__":
    from dotenv import load_dotenv
    from pathlib import Path

    load_dotenv(Path(__file__).parent.parent / ".env")
    sync()
