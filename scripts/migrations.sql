-- Run this in the Supabase SQL editor if you haven't already.
-- The cache table is used for Exa results, LLM outputs, AND conversation history.
-- If it already exists in your project, skip this.

CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

GRANT ALL PRIVILEGES ON TABLE cache TO postgres, service_role, anon, authenticated;
