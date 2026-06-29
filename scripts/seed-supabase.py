"""
Supabase Seeding and Migration Script
-------------------------------------
Use this script to seed your Supabase database with your local brain/ directory state.

Instructions:
1. Copy the SQL schema below and run it in the Supabase SQL Editor.
2. Ensure you have SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in your local .env file.
3. Run this script: python3 scripts/seed-supabase.py

SQL SCHEMA (RUN IN SUPABASE SQL EDITOR):
----------------------------------------

-- 1. Create startups table
CREATE TABLE startups (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    one_liner TEXT,
    website TEXT,
    founded TEXT,
    location TEXT,
    team_size INTEGER,
    stage TEXT,
    raised TEXT,
    what_they_do TEXT,
    founders JSONB,
    signal_urls JSONB,
    sources JSONB,
    score JSONB,
    status TEXT DEFAULT 'new',
    enrichment_status TEXT DEFAULT 'pending',
    enrichment JSONB,
    found_date TEXT
);

-- 2. Create learning_patterns table
CREATE TABLE learning_patterns (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL, -- 'approved' or 'passed'
    pattern TEXT NOT NULL
);

-- 3. Create thesis table
CREATE TABLE thesis (
    id INTEGER PRIMARY KEY DEFAULT 1,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 4. Create runs table
CREATE TABLE runs (
    id SERIAL PRIMARY KEY,
    ts TEXT NOT NULL,
    trigger TEXT NOT NULL,
    summary TEXT NOT NULL,
    found INTEGER NOT NULL
);

-- 5. Create founders table
CREATE TABLE founders (
    slug TEXT PRIMARY KEY,
    content TEXT NOT NULL
);

-- 6. Grant privileges to service_role, anon, and authenticated roles
GRANT ALL PRIVILEGES ON TABLE thesis TO postgres, service_role, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE startups TO postgres, service_role, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE learning_patterns TO postgres, service_role, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE runs TO postgres, service_role, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE founders TO postgres, service_role, anon, authenticated;

-- 7. Grant sequence privileges for auto-incrementing serial columns
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role, anon, authenticated;

"""

import sys
import os
import json
from pathlib import Path

# Add repo root and agent/ to sys.path
root = Path(__file__).parent.parent
sys.path.append(str(root / "agent"))

from dotenv import load_dotenv
load_dotenv(root / ".env")

from supabase import create_client, Client
from models import Startup

BRAIN_DIR = root / "brain"

def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or ""
    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in your .env file.")
        sys.exit(1)
    return create_client(url, key)

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

def parse_startup_md(file_path):
    content = file_path.read_text()
    try:
        json_str = content.split("```json")[1].split("```")[0].strip()
        raw = json.loads(json_str)
        # Validate using Pydantic model to ensure consistency
        return Startup.model_validate(raw)
    except Exception as e:
        print(f"Failed to parse startup {file_path.name}: {e}")
        return None

def seed():
    client = get_client()
    print("Connecting to Supabase...")
    
    # 1. Seed Thesis
    thesis_path = BRAIN_DIR / "thesis.md"
    if thesis_path.exists():
        print("Seeding Thesis...")
        content = thesis_path.read_text()
        import datetime
        now_str = datetime.datetime.now().isoformat()
        client.table("thesis").upsert({
            "id": 1,
            "content": content,
            "updated_at": now_str
        }).execute()
        print("Thesis seeded!")

    # 2. Seed Learning Patterns
    app_patterns_path = BRAIN_DIR / "learning" / "approved-patterns.md"
    pass_patterns_path = BRAIN_DIR / "learning" / "passed-patterns.md"
    
    # Clear existing patterns to avoid duplicates
    client.table("learning_patterns").delete().neq("id", 0).execute()
    
    if app_patterns_path.exists():
        print("Seeding Approved Patterns...")
        patterns = parse_patterns(app_patterns_path)
        for p in patterns:
            client.table("learning_patterns").insert({
                "type": "approved",
                "pattern": p
            }).execute()
        print(f"Seeded {len(patterns)} approved patterns!")
        
    if pass_patterns_path.exists():
        print("Seeding Passed Patterns...")
        patterns = parse_patterns(pass_patterns_path)
        for p in patterns:
            client.table("learning_patterns").insert({
                "type": "passed",
                "pattern": p
            }).execute()
        print(f"Seeded {len(patterns)} passed patterns!")

    # 3. Seed Startups
    startups_dir = BRAIN_DIR / "startups"
    if startups_dir.exists():
        print("Seeding Startups...")
        count = 0
        for file in startups_dir.glob("*.md"):
            startup = parse_startup_md(file)
            if startup:
                # model_dump serializes nested models (Founder, ScoreBreakdown) into dicts
                data = startup.model_dump()
                client.table("startups").upsert(data).execute()
                count += 1
        print(f"Seeded {count} startups!")

    print("Supabase Seeding completed successfully!")

if __name__ == "__main__":
    seed()
