-- Run once in the Supabase SQL editor. Egress reduction.
--
-- The dashboard list used to fetch `select("*")` from `startups` — on every server
-- render, every /api/startups call, and every poll tick. That dragged along the three
-- heaviest columns in the table for every row, none of which the list actually
-- renders:
--
--   founders            JSONB, up to 5 founders x 8 positions x ~400-char descriptions
--                       plus background/credibility_note — tens of KB on an enriched row
--   company_description up to 1500 chars
--   signal_urls         JSONB array, never rendered in the list at all
--
-- The only thing the list needed from any of them was a yes/no "is this enriched"
-- for the badge and the Enrich button. That's now this column, so the list can select
-- ~15 small columns instead of the whole row, and the full row is fetched per-slug
-- only when you actually open a startup.

ALTER TABLE startups ADD COLUMN IF NOT EXISTS enriched BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the existing data, matching hasEnrichmentData() in
-- src/lib/enrichment.ts exactly: any populated company/stage/raised/location field,
-- or a founder with real researched career history (a bare name from a stealth save
-- does not count as enrichment).
UPDATE startups
   SET enriched = true
 WHERE enriched = false
   AND (
        btrim(coalesce(company_description, '')) <> ''
     OR btrim(coalesce(stage, '')) <> ''
     OR btrim(coalesce(raised, '')) <> ''
     OR btrim(coalesce(location, '')) <> ''
     OR (
          jsonb_typeof(coalesce(founders, '[]'::jsonb)) = 'array'
          AND EXISTS (
            SELECT 1
              FROM jsonb_array_elements(coalesce(founders, '[]'::jsonb)) AS f
             WHERE jsonb_typeof(f -> 'positions') = 'array'
               AND jsonb_array_length(f -> 'positions') > 0
          )
        )
   );

-- Kept current going forward by modal_app.py's enrich_startup_job (on a successful
-- enrichment) and agent/startups_store.py's save_startups_batch (a stealth save that
-- already carries researched founder positions).

-- How much this saves, on your own data — compare the average full row against the
-- list columns:
--   SELECT pg_size_pretty(sum(pg_column_size(t))::bigint) AS full_table,
--          pg_size_pretty(sum(pg_column_size(founders)
--                           + pg_column_size(company_description)
--                           + pg_column_size(signal_urls))::bigint) AS dropped_from_list,
--          count(*) AS rows
--     FROM startups t;
