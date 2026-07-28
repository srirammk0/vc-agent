-- Run this in the Supabase SQL editor.
-- Adds "responded" as a valid dealflow status on startups.status.
--
-- Safe to run even if a constraint already exists from a prior attempt:
ALTER TABLE startups DROP CONSTRAINT IF EXISTS startups_status_check;

ALTER TABLE startups ADD CONSTRAINT startups_status_check
  CHECK (status IN ('new', 'approved', 'responded', 'call_booked', 'passed'));
