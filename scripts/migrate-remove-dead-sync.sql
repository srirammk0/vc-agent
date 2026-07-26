-- Run once in the Supabase SQL editor.
--
-- Removes dead weight from two already-decommissioned subsystems, confirmed via
-- `pg_stat_statements` and a full grep of the codebase before writing this:
--
-- 1. `thesis` table: an earlier version of this project mirrored Supermemory's
--    vc:thesis container into this table on a 4-hourly Trigger.dev cron
--    (agent/sync.py -> modal_app.py's sync_scheduled/sync_on_demand). Nothing in
--    src/ has ever read it — Supermemory (vc:thesis) is the actual source of truth
--    the agent queries every turn. The whole sync mechanism (that cron, both Modal
--    functions, the two .spawn() call sites after feedback/SMS replies,
--    agent/sync.py itself) has been removed from the codebase in the same change
--    that adds this migration — this just catches Supabase up.
--
-- 2. `signals` + its cache rows: `signals` was already documented as a legacy table
--    from a removed crawling subsystem ("nothing writes to it anymore"), confirmed
--    empty (0 rows) with no active writer. The old subsystem also left ~3,000
--    orphaned rows in the `cache` table under two dead key prefixes.
--
-- None of this reflects live traffic — it's leftover from history, not something to
-- chase for egress. It's being removed for the same reason it was flagged: it's
-- surface area and confusion with no upside, and the project's own README claimed
-- it was already gone.

DROP TABLE IF EXISTS thesis;
DROP TABLE IF EXISTS signals;

DELETE FROM cache WHERE key LIKE 'signal:%';
DELETE FROM cache WHERE key LIKE 'finc:%';

-- Verify nothing unexpected is left in either dead namespace:
--   SELECT split_part(key, ':', 1) AS namespace, count(*)
--     FROM cache GROUP BY 1 ORDER BY 2 DESC;
