-- Run once in the Supabase SQL editor.
-- Backs the agent's self-scheduling primitive (agent/scheduler.py): a row here is
-- future work the agent asked for itself (a signal re-check, a boss-requested
-- follow-up text), popped by the scheduled_tasks_poller Modal cron. Modal has no
-- native delayed-execution support, so this polling table is the mechanism.

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,                       -- 'signal_recheck' | 'text_followup'
    due_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'done' | 'cancelled'
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks (status, due_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_signal
  ON scheduled_tasks ((payload->>'signal_id'))
  WHERE kind = 'signal_recheck';

-- Service role only — the dashboard's Scheduled Runs page reads this through
-- /api/scheduled-runs (server-side), never directly from the browser, so the public
-- anon key needs no access. RLS with no policy denies everyone but the service role.
GRANT ALL PRIVILEGES ON TABLE scheduled_tasks TO postgres, service_role;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks FORCE ROW LEVEL SECURITY;
