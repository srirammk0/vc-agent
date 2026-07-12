-- Run this in the Supabase SQL editor.
-- Adds outreach tracking so the dashboard can show, per startup: stealth or not,
-- and LinkedIn/email outreach state (not_contacted -> contacted -> replied).
-- Dashboard-only fields — the agent never writes these, the boss does.

ALTER TABLE startups ADD COLUMN IF NOT EXISTS stealth boolean NOT NULL DEFAULT false;

ALTER TABLE startups ADD COLUMN IF NOT EXISTS linkedin_status text NOT NULL DEFAULT 'not_contacted';
ALTER TABLE startups ADD CONSTRAINT startups_linkedin_status_check
  CHECK (linkedin_status IN ('not_contacted', 'contacted', 'replied'));

ALTER TABLE startups ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_contacted';
ALTER TABLE startups ADD CONSTRAINT startups_email_status_check
  CHECK (email_status IN ('not_contacted', 'contacted', 'replied'));
