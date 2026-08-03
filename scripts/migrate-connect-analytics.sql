-- Exa Connect enrichment: Similarweb traffic + competitors, Fiber company meta.
-- Run once in the Supabase SQL editor.
--
-- List queries stay lean: only monthly_visits + has_email are denormalized for
-- sort/filter chips. web_analytics, competitors, fiber_meta are detail-only JSONB
-- (fetched on single-slug open, not on STARTUP_LIST_COLUMNS).

ALTER TABLE startups ADD COLUMN IF NOT EXISTS monthly_visits bigint;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS global_rank integer;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS web_analytics jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS competitors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS fiber_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS has_email boolean NOT NULL DEFAULT false;

-- Backfill has_email from existing founder emails.
UPDATE startups
   SET has_email = true
 WHERE has_email = false
   AND jsonb_typeof(coalesce(founders, '[]'::jsonb)) = 'array'
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(coalesce(founders, '[]'::jsonb)) AS f
      WHERE btrim(coalesce(f ->> 'email', '')) <> ''
   );

-- Backfill monthly_visits from web_analytics if you ever hand-import rows.
UPDATE startups
   SET monthly_visits = (web_analytics ->> 'monthly_visits')::bigint
 WHERE monthly_visits IS NULL
   AND web_analytics ? 'monthly_visits'
   AND (web_analytics ->> 'monthly_visits') ~ '^[0-9]+$';
