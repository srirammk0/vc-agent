"""Client for scheduling one-off future work on Trigger.dev.

This is the counterpart to src/trigger/run-scheduled-check.ts: Trigger.dev calls that
task back (running agent/main.py via its Python extension) when a delayed trigger
fires. Trigger.dev owns timing only — deciding what/when to schedule stays entirely in
Python (agent/agent.py's schedule_agent_run tool). Uses Trigger.dev's plain REST API
directly (no JS SDK — this runs inside a Python subprocess Trigger.dev shells out to,
not in Node).
"""

import os
from datetime import datetime, timezone
from typing import Optional

import httpx

import scheduled_tasks_log

_TRIGGER_TRIGGER_URL = "https://api.trigger.dev/api/v1/tasks/run-scheduled-check/trigger"
_TRIGGER_RUNS_URL = "https://api.trigger.dev/api/v2/runs"


async def schedule_check(
    kind: str,
    payload: dict,
    due_at: datetime,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Schedule Trigger.dev's `run-scheduled-check` task to fire at due_at (which
    runs agent/main.py via python.runScript with
    {"mode": "scheduled_check", "kind": kind, **payload} — see agent.py's
    run_scheduled_check). Returns True on success, False otherwise (never raises —
    callers treat this as a best-effort scheduling call, same as the old
    Supabase-backed scheduler.write_scheduled_task).

    Also logs a pending row to the scheduled_tasks table (agent/scheduled_tasks_log.py)
    purely so the agent can later answer "what do I have scheduled" — this bookkeeping
    is itself best-effort and never affects the return value; the real schedule already
    succeeded by the time it runs."""
    secret = os.environ.get("TRIGGER_SECRET_KEY", "")
    if not secret:
        print("trigger_client: TRIGGER_SECRET_KEY not set, cannot schedule")
        return False

    # mode="scheduled_check" is what run_agent() dispatches this whole payload
    # shape on (see agent.py) — kind is then a sub-dispatch WITHIN that mode
    # ("agent_followup" vs. the legacy "text_followup"), unchanged from before.
    full_payload = {"mode": "scheduled_check", "kind": kind, **payload}
    task_id = scheduled_tasks_log.log_task(kind, payload, due_at)
    if task_id:
        full_payload["_task_id"] = task_id

    body = {
        "payload": full_payload,
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
            # Stash the run id into the logged row (best-effort) so a later
            # cancel_check(task_id) call can actually stop this run, not just
            # delete our own visibility-log row.
            if task_id:
                try:
                    run_id = res.json().get("id")
                    if run_id:
                        scheduled_tasks_log.attach_run_id(task_id, run_id)
                except Exception as e:
                    print(f"trigger_client: failed to read run id for kind={kind}:", e)
            return True
    except Exception as e:
        print(f"trigger_client: schedule_check failed for kind={kind}:", e)
        return False


async def cancel_check(run_id: str) -> bool:
    """Cancel a Trigger.dev run before it fires (POST /api/v2/runs/{runId}/cancel).
    Never raises — best-effort, same as schedule_check."""
    secret = os.environ.get("TRIGGER_SECRET_KEY", "")
    if not secret or not run_id:
        return False

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{_TRIGGER_RUNS_URL}/{run_id}/cancel",
                headers={
                    "Authorization": f"Bearer {secret}",
                    "Content-Type": "application/json",
                },
            )
            res.raise_for_status()
            return True
    except Exception as e:
        print(f"trigger_client: cancel_check failed for run_id={run_id}:", e)
        return False


async def cancel_scheduled_task(task_id: str) -> str:
    """Cancel a pending scheduled task by its scheduled_tasks_log id — cancels the
    underlying Trigger.dev run (if one's tracked) and removes the log row. Used by
    agent.py's delete_scheduled_task chat tool. The dashboard's own Cancel button
    (src/lib/scheduledTasks.ts) is a separate TypeScript port of this same logic
    rather than calling into this — see that file's docstring for why (the dashboard
    needs a real synchronous answer for its button click; Trigger.dev tasks are
    async, so routing through one here would mean polling for a result instead of a
    small, stable amount of duplicated REST-call logic).

    Returns one of: "canceled", "removed_untracked" (predates run-id tracking, log
    row removed but the underlying job couldn't be confirmed stopped), "not_found",
    "cancel_failed" (Trigger.dev call itself failed — nothing changed, safe to retry)."""
    task = scheduled_tasks_log.get_task(task_id)
    if not task:
        return "not_found"
    run_id = (task.get("payload") or {}).get("_trigger_run_id")
    if run_id:
        ok = await cancel_check(run_id)
        if not ok:
            return "cancel_failed"
        scheduled_tasks_log.delete_task(task_id)
        return "canceled"
    scheduled_tasks_log.delete_task(task_id)
    return "removed_untracked"


async def reschedule_task(task_id: str, new_due_at: datetime) -> str:
    """Change a pending scheduled task's due time. Trigger.dev has no in-place
    reschedule, so this cancels the old run (if tracked) and schedules a fresh one
    with the same kind/instructions at new_due_at — a new scheduled_tasks row, with
    the old one removed only once the new one is confirmed scheduled (so a failure
    here never loses the task entirely, worst case it's left un-rescheduled under
    its old row rather than silently dropped).

    Returns one of: "rescheduled", "not_found", "cancel_failed" (old run couldn't be
    canceled, nothing changed), "reschedule_failed" (canceled the old one but
    couldn't schedule the new one — old row is gone from Trigger.dev's side but its
    log row is left in place as a visible sign something needs manual attention)."""
    task = scheduled_tasks_log.get_task(task_id)
    if not task:
        return "not_found"
    run_id = (task.get("payload") or {}).get("_trigger_run_id")
    if run_id:
        ok = await cancel_check(run_id)
        if not ok:
            return "cancel_failed"
    kind = task.get("kind", "agent_followup")
    # Strip the internal bookkeeping keys schedule_check/attach_run_id stashed in —
    # it injects its own fresh _task_id, and the old _trigger_run_id would otherwise
    # be carried over onto a task it no longer refers to.
    payload = {k: v for k, v in (task.get("payload") or {}).items() if not k.startswith("_")}
    ok = await schedule_check(kind, payload, new_due_at)
    if not ok:
        return "reschedule_failed"
    scheduled_tasks_log.delete_task(task_id)
    return "rescheduled"
