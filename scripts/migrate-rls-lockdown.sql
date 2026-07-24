-- Run once in the Supabase SQL editor. Security fix — apply to any existing project.
--
-- What was wrong
-- --------------
-- scripts/migrations.sql and scripts/migrate-scheduled-tasks.sql each ran
-- `GRANT ALL PRIVILEGES ... TO anon` and never enabled row-level security on their
-- table. `anon` is the key shipped to every browser (NEXT_PUBLIC_SUPABASE_ANON_KEY,
-- used for realtime), so both tables were world-readable AND world-writable by
-- anyone who opened devtools on the dashboard:
--
--   * `cache` holds the agent's full iMessage conversation history with the boss,
--     plus the cached thesis and learned preferences. Readable = private
--     conversations leak. Writable = an attacker can plant text that gets loaded
--     straight into the agent's context on its next turn, upstream of every
--     prompt-injection rule in agent/prompts.py.
--   * `scheduled_tasks` exposes pending agent work and lets anyone delete it.
--
-- Neither table is ever read from the browser: agent/cache.py and
-- agent/scheduled_tasks_log.py use the service-role key, and the dashboard reads
-- scheduled tasks through /api/scheduled-runs (server-side, also service role).
-- So anon needs no access at all here.

-- 1. cache: revoke anon/authenticated entirely, then RLS with no policy = deny all
--    for anyone but the service role (which bypasses RLS).
REVOKE ALL PRIVILEGES ON TABLE cache FROM anon, authenticated;
ALTER TABLE cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache FORCE ROW LEVEL SECURITY;

-- 2. scheduled_tasks: same treatment.
REVOKE ALL PRIVILEGES ON TABLE scheduled_tasks FROM anon, authenticated;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks FORCE ROW LEVEL SECURITY;

-- 3. startups / thesis: RLS was already on with a read-only policy, so these were
--    not exposed for writes — but the underlying grant was still ALL PRIVILEGES.
--    Narrow it to SELECT so the grant matches the intent (browser realtime reads
--    only); all writes go through the service role server-side.
REVOKE ALL PRIVILEGES ON TABLE startups FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE thesis FROM anon, authenticated;
GRANT SELECT ON TABLE startups TO anon, authenticated;
GRANT SELECT ON TABLE thesis TO anon, authenticated;

-- 4. Sequences were granted to anon wholesale by the original schema; nothing
--    browser-side inserts, so take that back too.
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Verify (each of cache/scheduled_tasks should report rowsecurity = true, and no
-- anon grants should remain on them):
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
