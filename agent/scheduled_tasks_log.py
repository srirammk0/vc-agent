"""Visibility log for agent/trigger_client.py's self-scheduling primitive.

Trigger.dev owns actual timing (see trigger_client.py) — this module just keeps a
best-effort record of what's pending so the agent can answer "what do you have
scheduled" (agent/agent.py's list_scheduled_tasks tool). Backed by the
`scheduled_tasks` table (scripts/migrate-scheduled-tasks.sql), which predates the
Trigger.dev migration as a polling table and is repurposed here as a pure log —
nothing polls it anymore.

Never raises: a failure here must never make a real schedule_check call look like
it failed, since the actual scheduling already succeeded by the time these are
called.
"""

import os
from datetime import datetime, timezone
from typing import Optional

from supabase import create_client


def _sb_client():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    return create_client(url, key)


def log_task(kind: str, payload: dict, due_at: datetime) -> Optional[str]:
    """Insert a pending row for a just-scheduled task. Returns the new row's id,
    or None on any failure (missing config, insert error)."""
    sb = _sb_client()
    if sb is None:
        return None
    try:
        res = (
            sb.table("scheduled_tasks")
            .insert({
                "kind": kind,
                "due_at": due_at.astimezone(timezone.utc).isoformat(),
                "payload": payload,
                "status": "pending",
            })
            .execute()
        )
        rows = res.data or []
        return rows[0]["id"] if rows else None
    except Exception as e:
        print(f"scheduled_tasks_log: log_task failed for kind={kind}:", e)
        return None


def mark_done(task_id: Optional[str]) -> None:
    """Mark a logged task as done. No-op if task_id is falsy."""
    if not task_id:
        return
    sb = _sb_client()
    if sb is None:
        return
    try:
        sb.table("scheduled_tasks").update({"status": "done"}).eq("id", task_id).execute()
    except Exception as e:
        print(f"scheduled_tasks_log: mark_done failed for id={task_id}:", e)


def attach_run_id(task_id: Optional[str], run_id: Optional[str]) -> None:
    """Stash the Trigger.dev run id into a logged row's payload (merged into the
    existing JSONB column, no schema change) so delete_task's caller can later cancel
    the real run, not just this log row. No-op if either id is falsy."""
    if not task_id or not run_id:
        return
    sb = _sb_client()
    if sb is None:
        return
    try:
        res = (
            sb.table("scheduled_tasks")
            .select("payload")
            .eq("id", task_id)
            .maybe_single()
            .execute()
        )
        row = getattr(res, "data", None) or {}
        payload = {**(row.get("payload") or {}), "_trigger_run_id": run_id}
        sb.table("scheduled_tasks").update({"payload": payload}).eq("id", task_id).execute()
    except Exception as e:
        print(f"scheduled_tasks_log: attach_run_id failed for task_id={task_id}:", e)


def get_task(task_id: str) -> Optional[dict]:
    """Fetch one logged task by id, or None if missing/on any failure."""
    sb = _sb_client()
    if sb is None:
        return None
    try:
        res = (
            sb.table("scheduled_tasks")
            .select("id, kind, due_at, payload, status")
            .eq("id", task_id)
            .maybe_single()
            .execute()
        )
        return getattr(res, "data", None)
    except Exception as e:
        print(f"scheduled_tasks_log: get_task failed for task_id={task_id}:", e)
        return None


def delete_task(task_id: str) -> bool:
    """Remove a logged row outright (used once its underlying Trigger.dev run has been
    canceled, or when it never had one to cancel). Returns False on any failure."""
    sb = _sb_client()
    if sb is None:
        return False
    try:
        sb.table("scheduled_tasks").delete().eq("id", task_id).execute()
        return True
    except Exception as e:
        print(f"scheduled_tasks_log: delete_task failed for task_id={task_id}:", e)
        return False


def list_pending(limit: int = 20) -> list[dict]:
    """Pending scheduled tasks, soonest due first. Returns [] on any failure."""
    sb = _sb_client()
    if sb is None:
        return []
    try:
        res = (
            sb.table("scheduled_tasks")
            .select("id, kind, due_at, payload")
            .eq("status", "pending")
            .order("due_at")
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print("scheduled_tasks_log: list_pending failed:", e)
        return []
