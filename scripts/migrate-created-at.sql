-- Run once in the Supabase SQL editor.
-- Preserves insert-time ordering for the dashboard (found_date is date-only).

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

UPDATE startups
SET created_at = COALESCE(updated_at, now())
WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_startups_created_at ON startups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_startups_status_created ON startups (status, created_at DESC);
