import type { ScheduledTask } from "./supabase";

/**
 * How long past its due time a still-'pending' row is given before it stops counting
 * as upcoming.
 *
 * `status` on scheduled_tasks is not authoritative. Trigger.dev owns the actual
 * timing; this table is a best-effort visibility log, and the only thing that ever
 * flips a row to 'done' is mark_done() inside Modal's run_scheduled_check — which is
 * explicitly allowed to fail silently (it must never make a real schedule look like
 * it failed). So a row stays 'pending' forever if the run never fired, fired without
 * a _task_id, or fired but mark_done errored. Those rows sat in "Upcoming" forever
 * claiming they were still going to happen.
 *
 * The grace window exists because a row that just came due may legitimately be
 * mid-flight: Trigger.dev fires it, Modal runs the agent (up to 10 min), and only
 * then does mark_done land. An hour is comfortably past that.
 */
export const OVERDUE_GRACE_MS = 60 * 60 * 1000;

/** True if this row is genuinely still ahead of us — pending AND not long overdue. */
export function isUpcoming(task: ScheduledTask, now: number = Date.now()): boolean {
  if (task.status !== "pending") return false;
  const due = new Date(task.due_at).getTime();
  if (Number.isNaN(due)) return false;
  return due > now - OVERDUE_GRACE_MS;
}

/**
 * True for a row that's past but was never marked done — it almost certainly ran and
 * the bookkeeping was lost, but we can't claim an outcome we don't have, so the UI
 * says so quietly instead of inventing one.
 */
export function ranWithoutRecordedOutcome(task: ScheduledTask, now: number = Date.now()): boolean {
  return task.status === "pending" && !isUpcoming(task, now);
}
