import sys
from pathlib import Path
from datetime import datetime, timezone

BRAIN_DIR = Path(__file__).parent.parent / "brain"


def load_thesis() -> str:
    return (BRAIN_DIR / "thesis.md").read_text()


def load_known_startups() -> str:
    index = BRAIN_DIR / "index.md"
    return index.read_text() if index.exists() else "No startups indexed yet."


async def write_startup(startup: dict) -> str:
    """Write a new or updated startup file to the brain."""
    slug = startup["slug"]
    path = BRAIN_DIR / "startups" / f"{slug}.md"

    score = startup.get("score", {})
    founders_text = _format_founders(startup.get("founders", []))
    total = score.get("total", 0)
    found_date = startup.get("found_date", datetime.now().strftime("%Y-%m-%d"))
    today = datetime.now().strftime("%Y-%m-%d")

    content = f"""# {startup['name']}

**Status:** {startup.get('status', 'new')}
**Score:** {total}/100
**Found:** {found_date}
**Last Updated:** {today}

## Basics
- **Website:** {startup.get('website', 'N/A')}
- **Founded:** {startup.get('founded', 'N/A')}
- **Location:** {startup.get('location', 'N/A')}
- **Team Size:** {startup.get('team_size', 'N/A')}
- **Stage:** {startup.get('stage', 'N/A')}
- **Raised:** {startup.get('raised', 'N/A')}

## What They Do
{startup.get('what_they_do', 'N/A')}

## Founders
{founders_text}

## Signal
- **Source:** {startup.get('signal_source', 'N/A')}
- **URL:** {startup.get('signal_url', 'N/A')}

## Score Breakdown
| Criteria | Score | Max |
|---|---|---|
| Founder pedigree | {score.get('founder_pedigree', 0)} | 25 |
| AI-native | {score.get('ai_native', 0)} | 20 |
| Stage fit | {score.get('stage_fit', 0)} | 20 |
| Recency | {score.get('recency', 0)} | 15 |
| Traction | {score.get('traction', 0)} | 10 |
| Geo fit | {score.get('geo_fit', 0)} | 10 |
| **Total** | **{total}** | **100** |

## Notes
<!-- Add your notes here -->

## Raw Links
- [{startup.get('signal_url', '')}]({startup.get('signal_url', '')})
"""
    path.write_text(content)
    print(f"[brain] Written: {slug}.md", file=sys.stderr)
    return f"Written: {slug}.md"


def write_run_log(summary: dict, payload: dict) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    path = BRAIN_DIR / "runs" / f"{ts}.md"

    new_startups = summary.get("new_startups", [])
    high_signal = summary.get("high_signal", [])

    content = f"""# Run: {ts}

**Trigger:** {payload.get('trigger', 'unknown')}
**Duration:** {summary.get('duration_seconds', 0)}s
**Status:** success

## Summary
- Queries run: {summary.get('queries_run', 0)}
- Pages enriched: {summary.get('pages_enriched', 0)}
- New startups found: {summary.get('startups_found', 0)}
- Startups updated: {summary.get('startups_updated', 0)}
- Alerts sent: {summary.get('alerts_sent', 0)}
- Skipped known: {summary.get('skipped_known', 0)}

## New Startups
{chr(10).join(f"- [[{s}]]" for s in new_startups) or "- None"}

## High Signal (score ≥ 75)
{chr(10).join(f"- [[{s}]]" for s in high_signal) or "- None"}
"""
    path.write_text(content)


def update_index() -> None:
    startups_dir = BRAIN_DIR / "startups"
    rows = []
    for f in sorted(startups_dir.glob("*.md")):
        if f.name == "TEMPLATE.md":
            continue
        text = f.read_text()
        name = _extract_field(text, "# ", "\n")
        score = _extract_field(text, "**Score:** ", "/100")
        status = _extract_field(text, "**Status:** ", "\n")
        stage = _extract_field(text, "- **Stage:** ", "\n")
        raised = _extract_field(text, "- **Raised:** ", "\n")
        found = _extract_field(text, "**Found:** ", "\n")
        rows.append(f"| {name} | {score} | {status} | {stage} | {raised} | {found} |")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index_content = f"""# Startup Index

Last updated: {ts} | Total: {len(rows)} startups

| Name | Score | Status | Stage | Raised | Found |
|---|---|---|---|---|---|
{chr(10).join(rows)}
"""
    (BRAIN_DIR / "index.md").write_text(index_content)


def _extract_field(text: str, start: str, end: str) -> str:
    try:
        s = text.index(start) + len(start)
        e = text.index(end, s)
        return text[s:e].strip()
    except ValueError:
        return "N/A"


def _format_founders(founders: list) -> str:
    if not founders:
        return "- N/A"
    return "\n".join(
        f"- **{f.get('name', 'Unknown')}:** {f.get('background', '')}"
        for f in founders
    )
