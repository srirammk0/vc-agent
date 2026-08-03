"""Weekly Fiber.ai sourcing — one Exa Agent run, max 10 companies, Fiber only."""

import re

import memory_store as sm
import startups_store
from tools.exa_connect import run_fiber_sourcing


def _slugify(name: str) -> str:
    s = (name or "").lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:80] or "startup"


async def run_fiber_sourcing_job() -> dict:
    thesis = await sm.load_thesis()
    companies = await run_fiber_sourcing(thesis)

    if not companies:
        return {"status": "no_data", "found": 0, "saved": []}

    names = [c["name"].strip() for c in companies if c.get("name")]
    crosscheck = await startups_store.crosscheck_startups(names)

    items = []
    for c in companies:
        name = (c.get("name") or "").strip()
        if not name:
            continue
        one_liner = (c.get("one_liner") or "").strip()
        notes = (c.get("assessment_notes") or "").strip()
        assessment = notes or one_liner or f"Fiber sourcing hit for {name}."
        domain = (c.get("domain") or "").strip()
        website = domain if domain.startswith("http") else (f"https://{domain}" if domain else "")

        items.append(
            {
                "slug": _slugify(name),
                "name": name,
                "website": website,
                "one_liner": one_liner or assessment[:200],
                "assessment": assessment[:2000],
                "signal_urls": [],
            }
        )

    if not items:
        return {"status": "no_data", "found": 0, "saved": []}

    saved, skipped, errors = await startups_store.save_startups_batch(items)

    # Pre-fill stage/team when Fiber returned them at sourcing time
    prefill_updates = []
    for c in companies:
        name = (c.get("name") or "").strip()
        slug = _slugify(name)
        if slug not in saved:
            continue
        prefill_updates.append((slug, c))

    if prefill_updates:
        try:
            from supabase import create_client
            import os
            sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
            for slug, c in prefill_updates:
                patch: dict = {}
                visits = c.get("monthly_visits")
                if visits is not None:
                    try:
                        visits_int = int(visits)
                        if visits_int > 0:
                            patch["monthly_visits"] = visits_int
                            patch["web_analytics"] = {"monthly_visits": visits_int, "source": "fiber"}
                    except (TypeError, ValueError):
                        pass
                if c.get("stage"):
                    patch["stage"] = str(c["stage"])[:200]
                if c.get("raised"):
                    patch["raised"] = str(c["raised"])[:200]
                if c.get("team_size"):
                    patch["team_size"] = str(c["team_size"])[:200]
                if patch:
                    sb.table("startups").update(patch).eq("slug", slug).execute()
        except Exception as e:
            print(f"fiber_sourcing prefill failed: {e}")

    return {
        "status": "ok",
        "found": len(companies),
        "saved": saved,
        "skipped": skipped,
        "errors": errors,
        "crosscheck": crosscheck[:500] if crosscheck else "",
    }
