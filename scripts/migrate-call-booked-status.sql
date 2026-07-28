-- Run this in the Supabase SQL editor.
-- Adds "call_booked" as a valid dealflow status on startups.status.
--
-- The column already exists as plain TEXT (default 'new') with no CHECK constraint,
-- so existing rows are unaffected and you can start writing call_booked immediately
-- once the dashboard/API are deployed. This migration just documents the new value
-- and optionally enforces it at the DB layer.

-- Safe to run even if a constraint already exists from a prior attempt:
ALTER TABLE startups DROP CONSTRAINT IF EXISTS startups_status_check;

ALTER TABLE startups ADD CONSTRAINT startups_status_check
  CHECK (status IN ('new', 'approved', 'responded', 'call_booked', 'passed'));
