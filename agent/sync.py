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
    """Mirror the agent's Supermemory state into Supabase for the dashboard to read."""
    sm = Supermemory()
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    docs = sm.documents.list(container_tags=["vc:startups"], include_content=True)
    for doc in getattr(docs, "memories", []):
        meta = doc.metadata or {}
        content = getattr(doc, "content", "") or ""
        slug = getattr(doc, "custom_id", None) or re.sub(
            r"[^a-z0-9]+", "-", (meta.get("name") or "").lower()
        ).strip("-")
        if not slug:
            continue
        sb.table("startups").upsert({
            "slug": slug,
            "name": meta.get("name", "") or _extract_field(content, "Name"),
            "website": meta.get("website") or _extract_field(content, "Website"),
            "one_liner": meta.get("one_liner", "") or _extract_field(content, "One-liner"),
            "status": meta.get("status", "new"),
            "found_date": meta.get("found_date"),
            "assessment": _extract_assessment(content),
            "signal_urls": _extract_signal_urls(content),
            "updated_at": getattr(doc, "updated_at", None) or _now(),
        }).execute()

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
