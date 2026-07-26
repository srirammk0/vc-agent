-- HISTORICAL RECORD ONLY — do not run. The `signals` table this targets was dropped
-- by scripts/migrate-remove-dead-sync.sql (empty, no writer for a long time). Kept
-- in scripts/ as a record of that table's schema history, not as a migration to apply.
--
-- Original note:
-- Run once in the Supabase SQL editor.
-- Lets the signals scraper store the extracted company/product name per signal, so
-- future runs can recognize a startup that's already been surfaced (even from a
-- different post/platform) and avoid re-admitting it as a fresh "new" signal.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS company_name TEXT;

CREATE INDEX IF NOT EXISTS idx_signals_company_name ON signals (company_name);
