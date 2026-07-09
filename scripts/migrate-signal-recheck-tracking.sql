-- Run once in the Supabase SQL editor.
-- Guardrail state for signal re-checks, now that actual timing is delegated to
-- Trigger.dev (see agent/trigger_client.py) instead of the old Supabase
-- scheduled_tasks polling table. Tracks "how many times has this signal ever
-- been scheduled for a re-check" so agent/signals_review.py's
-- schedule_signal_check tool can still enforce the same cap as before
-- (max 2 re-checks per signal, ever).

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS recheck_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recheck_scheduled_at TIMESTAMPTZ;
