"""
Supabase Schema Migration + Supermemory Seeding
-----------------------------------------------
Supermemory holds the agent's thesis, preferences, and reflections. Supabase holds
dealflow, the scheduled-task log, and a general-purpose cache — all written to
directly, with no mirroring step between the two. (An earlier version of this schema
also mirrored the thesis into a Supabase `thesis` table on a cron; nothing ever read
it from `src/`, so it's gone — see scripts/migrate-remove-dead-sync.sql if you're
migrating an existing project that still has it.) This script:

1. Provides the new Supabase SQL schema (run it in the Supabase SQL Editor).
2. Seeds the initial thesis and learning patterns from brain/ into Supermemory.

Instructions:
1. Copy the SQL schema below and run it in the Supabase SQL Editor.
2. Ensure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPERMEMORY_API_KEY are
   set in your local .env file.
3. Run this script: python3 scripts/seed-supabase.py

SQL SCHEMA (RUN IN SUPABASE SQL EDITOR):
----------------------------------------

-- Dealflow, written directly (no Supermemory mirroring)
CREATE TABLE IF NOT EXISTS startups (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT,
    one_liner TEXT,
    assessment TEXT,
    status TEXT DEFAULT 'new',
    signal_urls JSONB DEFAULT '[]',
    found_date TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- Enrichment (populated by the enrichment job, not the agent)
    enrichment_status TEXT DEFAULT 'pending',
    company_description TEXT,
    founded TEXT,
    location TEXT,
    team_size TEXT,
    stage TEXT,
    raised TEXT,
    founders JSONB DEFAULT '[]'
);

-- Cache table (Exa results + enrichment LLM outputs)
CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Grant privileges. `anon` is the public key shipped to every browser, so it gets
-- SELECT on `startups` (the one table the dashboard subscribes to) and nothing
-- else — never the cache table (conversation history, thesis, preferences) and
-- never write access. All writes happen server-side with the service-role key.
GRANT ALL PRIVILEGES ON TABLE startups TO postgres, service_role;
GRANT ALL PRIVILEGES ON TABLE cache TO postgres, service_role;
GRANT SELECT ON TABLE startups TO anon, authenticated;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;

-- Indexes for fast dashboard queries (filter by status, sort by recency)
CREATE INDEX IF NOT EXISTS idx_startups_status ON startups (status);
CREATE INDEX IF NOT EXISTS idx_startups_found_date ON startups (found_date DESC);
CREATE INDEX IF NOT EXISTS idx_startups_created_at ON startups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_startups_status_created ON startups (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_startups_enrichment_status ON startups (enrichment_status);
CREATE INDEX IF NOT EXISTS idx_cache_created_at ON cache (created_at);

-- Realtime: let the dashboard subscribe to live row changes
ALTER PUBLICATION supabase_realtime ADD TABLE startups;

-- RLS: dashboard reads via the anon key (realtime respects RLS).
-- Writes stay server-side via the service role key, which bypasses RLS.
ALTER TABLE startups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read startups" ON startups;
CREATE POLICY "anon read startups" ON startups FOR SELECT TO anon, authenticated USING (true);

-- cache is service-role only: no anon grant above, RLS on with no policy at all.
ALTER TABLE cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache FORCE ROW LEVEL SECURITY;

-- Migration note: if a previous `startups` table exists with scoring columns,
-- drop it first (DROP TABLE startups CASCADE;) then recreate with the schema above.

"""

import sys
import hashlib
from pathlib import Path

root = Path(__file__).parent.parent

from dotenv import load_dotenv
load_dotenv(root / ".env")

from supermemory import Supermemory

BRAIN_DIR = root / "brain"


def parse_patterns(file_path):
    if not file_path.exists():
        return []
    content = file_path.read_text()
    patterns = []
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("- ") or line.startswith("* "):
            patterns.append(line[2:].strip())
    return patterns


def seed():
    client = Supermemory()
    print("Seeding Supermemory...")

    # 1. Seed thesis -> vc:thesis
    thesis_path = BRAIN_DIR / "thesis.md"
    if thesis_path.exists():
        print("Seeding thesis...")
        client.add(
            content=thesis_path.read_text(),
            container_tag="vc:thesis",
            custom_id="thesis",
            dreaming="instant",
        )
        print("Thesis seeded!")

    # 2. Seed learning patterns -> vc:preferences
    approved_path = BRAIN_DIR / "learning" / "approved-patterns.md"
    passed_path = BRAIN_DIR / "learning" / "passed-patterns.md"

    for path, pattern_type in [(approved_path, "approved"), (passed_path, "passed")]:
        patterns = parse_patterns(path)
        for p in patterns:
            h = hashlib.md5(p.encode()).hexdigest()[:8]
            client.add(
                content=p,
                container_tag="vc:preferences",
                custom_id=f"{pattern_type}-{h}",
                metadata={"type": pattern_type},
                dreaming="dynamic",
            )
        if patterns:
            print(f"Seeded {len(patterns)} {pattern_type} patterns!")

    print("Supermemory seeding completed successfully!")


if __name__ == "__main__":
    seed()
