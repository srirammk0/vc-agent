import { supabase } from "./supabase";
import { cancelTriggerRun, triggerSecret } from "./triggerClient";

/**
 * TypeScript port of agent/trigger_client.py's cancel_check/cancel_scheduled_task/
 * reschedule_task, for the dashboard's Cancel/Reschedule buttons specifically
 * (src/app/api/scheduled-runs/[id]/route.ts).
 *
 * Why a second implementation instead of routing through the Python agent (the way
 * /api/enrich and /api/feedback trigger the Trigger.dev task): those two are
 * fire-and-forget — the dashboard doesn't wait for or need their result, just an
 * ack that the job started. Cancel/reschedule are the opposite: the button click
 * needs a real synchronous answer ("not found", "cancelled", "failed — try again")
 * to show the user and to know whether to revert its optimistic UI update.
 * Trigger.dev tasks are async by nature — there's no supported way to synchronously
 * wait for a task's result from outside another task — so routing this through one
 * would mean either accepting a fire-and-forget response (silently wrong on
 * failure, since the UI would always report success) or polling for the run's
 * outcome. Given this logic is a handful of lines of REST calls plus a Supabase
 * update with no LLM/research involved, porting it directly here is simpler than
 * either. agent/trigger_client.py's Python version stays as-is — the
 * delete_scheduled_task chat tool still needs to run this mid-agent-run, in the
 * same process, no dispatch involved.
 */

const TRIGGER_TRIGGER_URL = "https://api.trigger.dev/api/v1/tasks/run-scheduled-check/trigger";

type TaskPayload = Record<string, unknown> & { _trigger_run_id?: string };

type ScheduledTaskRow = {
  id: string;
  kind: string | null;
  payload: TaskPayload | null;
};

/** Schedule Trigger.dev's run-scheduled-check task to fire at dueAt. Returns the
 * new Trigger.dev run id on success, or null (never throws — best-effort, same as
 * the Python version). */
async function scheduleCheck(
  kind: string,
  payload: Record<string, unknown>,
  dueAt: Date
): Promise<string | null> {
  const secret = triggerSecret();
  if (!secret) return null;
  try {
    const res = await fetch(TRIGGER_TRIGGER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: { mode: "scheduled_check", kind, ...payload },
        options: { delay: dueAt.toISOString() },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}) as { id?: string });
    return data.id ?? null;
  } catch {
    return null;
  }
}

async function getTask(taskId: string): Promise<ScheduledTaskRow | null> {
  const { data } = await supabase
    .from("scheduled_tasks")
    .select("id, kind, payload")
    .eq("id", taskId)
    .maybeSingle();
  return (data as ScheduledTaskRow | null) ?? null;
}

export type CancelStatus = "canceled" | "removed_untracked" | "not_found" | "cancel_failed";

/** Mirrors agent/trigger_client.py's cancel_scheduled_task exactly — cancels the
 * underlying Trigger.dev run (if one's tracked) and removes the log row. */
export async function cancelScheduledTask(taskId: string): Promise<CancelStatus> {
  const task = await getTask(taskId);
  if (!task) return "not_found";

  const runId = task.payload?._trigger_run_id;
  if (runId) {
    const ok = await cancelTriggerRun(runId);
    if (!ok) return "cancel_failed";
  }
  await supabase.from("scheduled_tasks").delete().eq("id", taskId);
  return runId ? "canceled" : "removed_untracked";
}

export type RescheduleStatus = "rescheduled" | "not_found" | "cancel_failed" | "reschedule_failed";

/** Mirrors agent/trigger_client.py's reschedule_task: cancel the old run (if
 * tracked), insert a fresh scheduled_tasks row at the new due time, schedule a new
 * Trigger.dev run against it, then remove the old row only once the new one is
 * confirmed scheduled — a failure here never loses the task entirely, worst case
 * it's left un-rescheduled under its old row rather than silently dropped. */
export async function rescheduleScheduledTask(
  taskId: string,
  newDueAt: Date
): Promise<RescheduleStatus> {
  const task = await getTask(taskId);
  if (!task) return "not_found";

  const oldPayload = task.payload ?? {};
  const runId = oldPayload._trigger_run_id;
  if (runId) {
    const ok = await cancelTriggerRun(runId);
    if (!ok) return "cancel_failed";
  }

  const kind = task.kind || "agent_followup";
  // Strip internal bookkeeping keys — the new row gets its own fresh id/run id,
  // and the old _trigger_run_id would otherwise be carried over onto a task it no
  // longer refers to.
  const cleanPayload = Object.fromEntries(
    Object.entries(oldPayload).filter(([k]) => !k.startsWith("_"))
  );

  const { data: inserted, error: insertError } = await supabase
    .from("scheduled_tasks")
    .insert({ kind, due_at: newDueAt.toISOString(), payload: cleanPayload, status: "pending" })
    .select("id")
    .single();
  if (insertError || !inserted) return "reschedule_failed";

  const newRunId = await scheduleCheck(kind, { ...cleanPayload, _task_id: inserted.id }, newDueAt);
  if (!newRunId) return "reschedule_failed";

  await supabase
    .from("scheduled_tasks")
    .update({ payload: { ...cleanPayload, _trigger_run_id: newRunId } })
    .eq("id", inserted.id);
  await supabase.from("scheduled_tasks").delete().eq("id", taskId);
  return "rescheduled";
}
