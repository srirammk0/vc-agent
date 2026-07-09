"""Client for scheduling one-off future work on Trigger.dev.

This is the counterpart to modal_app.py's `run_scheduled_check` endpoint: Trigger.dev
calls that endpoint back when a delayed trigger fires. Trigger.dev owns timing only —
deciding what/when to schedule stays entirely in Modal/Python (agent/signals_review.py's
schedule_signal_check tool, agent/agent.py's schedule_followup tool, and
agent/daily_planner.py). Uses Trigger.dev's plain REST API directly (no JS SDK — this
runs in Python/Modal, not Node).
"""

import os
from datetime import datetime, timezone
from typing import Optional

import httpx

_TRIGGER_TRIGGER_URL = "https://api.trigger.dev/api/v1/tasks/run-scheduled-check/trigger"


async def schedule_check(
    kind: str,
    payload: dict,
    due_at: datetime,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Schedule Trigger.dev's `run-scheduled-check` task to fire at due_at (which will
    call back into Modal's run_scheduled_check endpoint with {"kind": kind, **payload}).
    Returns True on success, False otherwise (never raises — callers treat this as a
    best-effort scheduling call, same as the old Supabase-backed scheduler.write_scheduled_task)."""
    secret = os.environ.get("TRIGGER_SECRET_KEY", "")
    if not secret:
        print("trigger_client: TRIGGER_SECRET_KEY not set, cannot schedule")
        return False

    body = {
        "payload": {"kind": kind, **payload},
        "options": {
            "delay": due_at.astimezone(timezone.utc).isoformat(),
        },
    }
    if idempotency_key:
        body["options"]["idempotencyKey"] = idempotency_key

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                _TRIGGER_TRIGGER_URL,
                headers={
                    "Authorization": f"Bearer {secret}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            res.raise_for_status()
            return True
    except Exception as e:
        print(f"trigger_client: schedule_check failed for kind={kind}:", e)
        return False
