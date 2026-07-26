import os
import datetime

from supermemory import Supermemory
from supabase import create_client


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sync():
    """Mirror the agent's Supermemory thesis into the Supabase `thesis` table.

    Startups are no longer mirrored here — they live directly in Supabase now
    (agent/startups_store.py reads and writes the `startups` table live), so this
    is just the thesis sync. Thesis stays Supermemory-owned (update_thesis in
    agent/memory_store.py); nothing in src/ currently reads the `thesis` table,
    this just keeps it available if/when something does.
    """
    sm = Supermemory()
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

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

    # Housekeeping, piggybacking on the existing cron rather than adding a second
    # schedule: clear scheduled_tasks rows still marked 'pending' well past their due
    # time. mark_done() in Modal's run_scheduled_check is best-effort by design, so a
    # run that never fired (or whose bookkeeping failed) otherwise leaves a row that
    # claims forever that it's still coming up.
    try:
        import scheduled_tasks_log

        swept = scheduled_tasks_log.sweep_overdue()
        if swept:
            print(f"sync: swept {swept} overdue scheduled_tasks row(s) to done")
    except Exception as e:
        print("sync: sweep_overdue failed:", e)


if __name__ == "__main__":
    from dotenv import load_dotenv
    from pathlib import Path

    load_dotenv(Path(__file__).parent.parent / ".env")
    sync()
