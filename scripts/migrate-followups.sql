-- Run once in the Supabase SQL editor.
-- Follow-up tracking, alongside the existing linkedin_status/email_status outreach
-- columns. Modelled as a counter rather than a three-state status: "how many times
-- have we chased this one" is the actual question, and the count already encodes the
-- status (0 = never followed up), so a separate enum would be a second source of
-- truth to keep in sync.
--
-- last_followup_at is what makes the count actionable — "approved, followed up twice,
-- last one six weeks ago" is a different situation from "followed up twice this week".

ALTER TABLE startups ADD COLUMN IF NOT EXISTS followup_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ;

-- Guard against a runaway increment writing nonsense into the column.
ALTER TABLE startups DROP CONSTRAINT IF EXISTS startups_followup_count_range;
ALTER TABLE startups ADD CONSTRAINT startups_followup_count_range
  CHECK (followup_count >= 0 AND followup_count <= 99);

-- Supports the dashboard's "followed up / not followed up" filter and the agent's
-- query_startups(followed_up=...) scan.
CREATE INDEX IF NOT EXISTS idx_startups_followup_count ON startups (followup_count);
