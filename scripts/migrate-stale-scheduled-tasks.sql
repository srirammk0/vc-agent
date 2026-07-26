-- Run once in the Supabase SQL editor.
--
-- Backfill for scheduled_tasks rows stuck at status='pending' long after their due_at
-- passed, which the dashboard kept listing under "Upcoming" forever.
--
-- How a row gets stuck: scheduled_tasks_log.mark_done() is called by Modal's
-- run_scheduled_check when a task fires, and it's deliberately best-effort (it must
-- never make a real schedule look like it failed). So if the Trigger.dev run never
-- fired, or fired without a _task_id, or mark_done itself errored, the row stays
-- 'pending' with nothing to ever move it. Nothing polls this table — Trigger.dev owns
-- timing — so "pending" here only ever meant "nobody told us otherwise".
--
-- Going forward this is a one-time cleanup, not something that needs to keep running:
-- the dashboard (src/lib/scheduledRuns.ts) and the agent's list_scheduled_tasks tool
-- (scheduled_tasks_log.list_pending) both treat a row more than an hour overdue as
-- past regardless of its stored status, so a stuck row can't resurface as "upcoming"
-- again even without this backfill — this just makes the stored column honest too.

UPDATE scheduled_tasks
   SET status = 'done'
 WHERE status = 'pending'
   AND due_at < now() - interval '1 hour';

-- Check what's actually still pending afterwards:
--   SELECT id, kind, due_at, status FROM scheduled_tasks
--    WHERE status = 'pending' ORDER BY due_at;
