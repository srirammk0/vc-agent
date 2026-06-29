import os
import json
from pathlib import Path
from models import Startup

BRAIN_DIR = Path(__file__).parent.parent / "brain"

def load_thesis() -> str:
    path = BRAIN_DIR / "thesis.md"
    if path.exists():
        return path.read_text()
    return ""

def update_thesis(new_content: str):
    path = BRAIN_DIR / "thesis.md"
    path.write_text(new_content)

def load_approved_patterns() -> str:
    path = BRAIN_DIR / "learning" / "approved-patterns.md"
    if path.exists():
        return path.read_text()
    return ""

def load_passed_patterns() -> str:
    path = BRAIN_DIR / "learning" / "passed-patterns.md"
    if path.exists():
        return path.read_text()
    return ""

def write_approved_pattern(pattern_content: str):
    """Append a new pattern to approved-patterns.md"""
    path = BRAIN_DIR / "learning" / "approved-patterns.md"
    if path.exists():
        current = path.read_text()
    else:
        current = "# Approved Patterns\n\n"
        path.parent.mkdir(parents=True, exist_ok=True)
        
    updated = current + f"\n{pattern_content}\n"
    path.write_text(updated)

def write_passed_pattern(pattern_content: str):
    """Append a new pattern to passed-patterns.md"""
    path = BRAIN_DIR / "learning" / "passed-patterns.md"
    if path.exists():
        current = path.read_text()
    else:
        current = "# Passed Patterns\n\n"
        path.parent.mkdir(parents=True, exist_ok=True)
        
    updated = current + f"\n{pattern_content}\n"
    path.write_text(updated)

def save_startup(startup: Startup):
    """Save or update a startup in the brain."""
    startups_dir = BRAIN_DIR / "startups"
    startups_dir.mkdir(parents=True, exist_ok=True)
    
    path = startups_dir / f"{startup.slug}.md"
    
    # Store as markdown with frontmatter (or just raw JSON inside md for easy parsing later)
    # Actually, a JSON block is great, but markdown is readable.
    content = f"""# {startup.name}
    
```json
{startup.model_dump_json(indent=2)}
```
"""
    path.write_text(content)
    
    # Update index.md
    update_index()

def get_startup(slug: str) -> Startup | None:
    path = BRAIN_DIR / "startups" / f"{slug}.md"
    if not path.exists():
        return None
        
    content = path.read_text()
    # Extract JSON block
    try:
        json_str = content.split("```json")[1].split("```")[0].strip()
        return Startup.model_validate_json(json_str)
    except Exception:
        return None
        
def get_all_startups() -> list[Startup]:
    startups_dir = BRAIN_DIR / "startups"
    if not startups_dir.exists():
        return []
    
    startups = []
    for file in startups_dir.glob("*.md"):
        slug = file.stem
        s = get_startup(slug)
        if s:
            startups.append(s)
    return startups

def update_index():
    path = BRAIN_DIR / "index.md"
    startups = get_all_startups()
    
    new_str = []
    approved_str = []
    passed_str = []
    
    for s in startups:
        line = f"- [{s.name}](./startups/{s.slug}.md) - Score: {s.score.total}"
        if s.status == "new":
            new_str.append(line)
        elif s.status == "approved":
            approved_str.append(line)
        elif s.status == "passed":
            passed_str.append(line)
            
    content = f"""# Master Startup Index

List of all startups processed by the agent.

## New
{chr(10).join(new_str)}

## Approved
{chr(10).join(approved_str)}

## Passed
{chr(10).join(passed_str)}
"""
    path.write_text(content)

def save_founder(founder_slug: str, content: str):
    """Save enriched founder details."""
    founders_dir = BRAIN_DIR / "founders"
    founders_dir.mkdir(parents=True, exist_ok=True)
    path = founders_dir / f"{founder_slug}.md"
    path.write_text(content)
