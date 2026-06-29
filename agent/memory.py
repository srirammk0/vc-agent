import os
import json
import datetime
from supabase import create_client, Client
from models import Startup

_client = None

def get_client() -> Client:
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or ""
        if not url or not key:
            raise Exception("SUPABASE_URL and SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY must be set in environment.")
        _client = create_client(url, key)
    return _client

def load_thesis() -> str:
    try:
        client = get_client()
        res = client.table("thesis").select("content").eq("id", 1).execute()
        if res.data:
            return res.data[0].get("content", "")
    except Exception as e:
        print("Failed to load thesis from Supabase:", e)
    return "No thesis configured."

def update_thesis(new_content: str):
    try:
        client = get_client()
        now_str = datetime.datetime.now().isoformat()
        client.table("thesis").upsert({
            "id": 1,
            "content": new_content,
            "updated_at": now_str
        }).execute()
    except Exception as e:
        print("Failed to update thesis in Supabase:", e)

def load_approved_patterns() -> str:
    try:
        client = get_client()
        res = client.table("learning_patterns").select("pattern").eq("type", "approved").execute()
        patterns = [r.get("pattern") for r in res.data if r.get("pattern")]
        if patterns:
            return "# Approved Patterns\n\n" + "\n".join(f"- {p}" for p in patterns)
    except Exception as e:
        print("Failed to load approved patterns:", e)
    return "# Approved Patterns\n\nNone yet."

def load_passed_patterns() -> str:
    try:
        client = get_client()
        res = client.table("learning_patterns").select("pattern").eq("type", "passed").execute()
        patterns = [r.get("pattern") for r in res.data if r.get("pattern")]
        if patterns:
            return "# Passed Patterns\n\n" + "\n".join(f"- {p}" for p in patterns)
    except Exception as e:
        print("Failed to load passed patterns:", e)
    return "# Passed Patterns\n\nNone yet."

def write_approved_pattern(pattern_content: str):
    try:
        client = get_client()
        client.table("learning_patterns").insert({
            "type": "approved",
            "pattern": pattern_content
        }).execute()
    except Exception as e:
        print("Failed to write approved pattern:", e)

def write_passed_pattern(pattern_content: str):
    try:
        client = get_client()
        client.table("learning_patterns").insert({
            "type": "passed",
            "pattern": pattern_content
        }).execute()
    except Exception as e:
        print("Failed to write passed pattern:", e)

def save_startup(startup: Startup):
    try:
        client = get_client()
        data = startup.model_dump()
        client.table("startups").upsert(data).execute()
    except Exception as e:
        print(f"Failed to save startup {startup.slug} to Supabase:", e)

def get_startup(slug: str) -> Startup | None:
    try:
        client = get_client()
        res = client.table("startups").select("*").eq("slug", slug).execute()
        if res.data:
            return Startup.model_validate(res.data[0])
    except Exception as e:
        print(f"Failed to get startup {slug} from Supabase:", e)
    return None

def get_all_startups() -> list[Startup]:
    try:
        client = get_client()
        res = client.table("startups").select("*").execute()
        return [Startup.model_validate(row) for row in res.data]
    except Exception as e:
        print("Failed to get all startups from Supabase:", e)
    return []

def update_index():
    # Deprecated: Supabase handles indexing and dashboard queries directly now.
    pass

def save_founder(founder_slug: str, content: str):
    try:
        client = get_client()
        client.table("founders").upsert({
            "slug": founder_slug,
            "content": content
        }).execute()
    except Exception as e:
        print("Failed to save founder to Supabase:", e)

def log_run(trigger: str, summary: str, found: int):
    try:
        client = get_client()
        now_str = datetime.datetime.now().isoformat()
        client.table("runs").insert({
            "ts": now_str,
            "trigger": trigger,
            "summary": summary,
            "found": found
        }).execute()
    except Exception as e:
        print("Failed to log run to Supabase:", e)

def get_recent_runs(limit: int = 5) -> list[dict]:
    try:
        client = get_client()
        res = client.table("runs").select("*").order("ts", desc=True).limit(limit).execute()
        return res.data
    except Exception as e:
        print("Failed to get runs from Supabase:", e)
        return []
