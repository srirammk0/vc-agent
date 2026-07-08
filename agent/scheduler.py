"""Self-scheduling primitive for the agent: Modal has no native delayed-execution
support (`modal.Cron` schedules are fixed at deploy time; `.spawn()`/`modal.Queue`
are immediate-dispatch only), so future work is a row in the Supabase
`scheduled_tasks` table, popped by a polling cron (`scheduled_tasks_poller` in
modal_app.py).

Two task kinds:
- "text_followup": payload {sender, instructions} — replayed through
  chat_reply_background as if the boss had just texted `instructions`.
- "signal_recheck": payload {signal_id, company_name, source_url} — re-scored via
  signals_review.recheck_signal.
"""

import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Optional

_client = None


def _get_client():
    global _client
    if _client is None:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or ""
        if not url or not key:
            return None
        _client = create_client(url, key)
    return _client


def _write_sync(kind: str, due_at: datetime, payload: dict) -> Optional[str]:
    client = _get_client()
    if client is None:
        return None
    try:
        res = (
            client.table("scheduled_tasks")
            .insert({
                "kind": kind,
                "due_at": due_at.astimezone(timezone.utc).isoformat(),
                "payload": payload,
                "status": "pending",
            })
            .execute()
        )
        row = (res.data or [None])[0]
        return row.get("id") if row else None
    except Exception as e:
        print("scheduler: write_scheduled_task failed:", e)
        return None


async def write_scheduled_task(kind: str, due_at: datetime, payload: dict) -> Optional[str]:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_write_sync, kind, due_at, payload), timeout=10.0
        )
    except Exception:
        return None


def _count_for_signal_sync(signal_id: str) -> int:
    client = _get_client()
    if client is None:
        return 0
    try:
        res = (
            client.table("scheduled_tasks")
            .select("id", count="exact")
            .eq("kind", "signal_recheck")
            .eq("payload->>signal_id", signal_id)
            .in_("status", ["pending", "done"])
            .execute()
        )
        return res.count or 0
    except Exception as e:
        print("scheduler: count_pending_or_done_for_signal failed:", e)
        return 0


async def count_pending_or_done_for_signal(signal_id: str) -> int:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_count_for_signal_sync, signal_id), timeout=10.0
        )
    except Exception:
        return 0


def _load_due_sync(limit: int) -> list[dict]:
    client = _get_client()
    if client is None:
        return []
    try:
        now = datetime.now(timezone.utc).isoformat()
        res = (
            client.table("scheduled_tasks")
            .select("*")
            .eq("status", "pending")
            .lte("due_at", now)
            .order("due_at")
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print("scheduler: load_due_tasks failed:", e)
        return []


async def load_due_tasks(limit: int = 20) -> list[dict]:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_load_due_sync, limit), timeout=10.0
        )
    except Exception:
        return []


def _set_status_sync(task_id: str, status: str) -> None:
    client = _get_client()
    if client is None:
        return
    try:
        client.table("scheduled_tasks").update({"status": status}).eq("id", task_id).execute()
    except Exception as e:
        print(f"scheduler: failed to set task {task_id} to {status}:", e)


async def mark_task_done(task_id: str) -> None:
    await asyncio.wait_for(asyncio.to_thread(_set_status_sync, task_id, "done"), timeout=10.0)


async def mark_task_cancelled(task_id: str) -> None:
    await asyncio.wait_for(asyncio.to_thread(_set_status_sync, task_id, "cancelled"), timeout=10.0)
