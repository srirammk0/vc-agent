"""
Supabase Schema Migration + Supermemory Seeding
-----------------------------------------------
Supermemory is now the agent's brain. Supabase is a read-only mirror for the
dashboard (populated by agent/sync.py). This script:

1. Provides the new Supabase SQL schema (run it in the Supabase SQL Editor).
2. Seeds the initial thesis and learning patterns from brain/ into Supermemory.

Instructions:
1. Copy the SQL schema below and run it in the Supabase SQL Editor.
2. Ensure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPERMEMORY_API_KEY are
   set in your local .env file.
3. Run this script: python3 scripts/seed-supabase.py

SQL SCHEMA (RUN IN SUPABASE SQL EDITOR):
----------------------------------------

-- Simplified startups table (mirror of Supermemory vc:startups)
CREATE TABLE IF NOT EXISTS startups (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT,
    one_liner TEXT,
    assessment TEXT,
    status TEXT DEFAULT 'new',
    signal_urls JSONB DEFAULT '[]',
    found_date TEXT,
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

-- Thesis table (mirror of Supermemory vc:thesis)
CREATE TABLE IF NOT EXISTS thesis (
    id INTEGER PRIMARY KEY DEFAULT 1,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Grant privileges
GRANT ALL PRIVILEGES ON TABLE startups TO postgres, service_role, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE thesis TO postgres, service_role, anon, authenticated;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role, anon, authenticated;

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
