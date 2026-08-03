-- Run this in the Supabase SQL editor if you haven't already.
-- The cache table is used for Exa results, LLM outputs, AND conversation history.
-- If it already exists in your project, skip this.

CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Service role only. This table holds conversation history, the cached thesis and
-- preferences — the browser never touches it, and `anon` is a public key, so it gets
-- no access. RLS with no policy denies everyone except the service role, which
-- bypasses RLS by design. (See scripts/migrate-rls-lockdown.sql if you ran an earlier
-- version of this file, which granted anon full read/write.)
GRANT ALL PRIVILEGES ON TABLE cache TO postgres, service_role;
ALTER TABLE cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache FORCE ROW LEVEL SECURITY;

ALTER TABLE startups ADD COLUMN IF NOT EXISTS enrichment_error TEXT;
