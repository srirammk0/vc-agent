"""Which enrichment fields are still missing on a startup row — drives partial
Exa Connect runs so we don't re-pay for data already in Supabase."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _text(val: Any) -> str:
    return (val or "").strip()


def _founders_list(row: dict) -> list[dict]:
    raw = row.get("founders")
    if not isinstance(raw, list):
        return []
    return [f for f in raw if isinstance(f, dict)]


def _founders_have_timeline(founders: list[dict]) -> bool:
    return any((f.get("positions") or []) for f in founders)


def _founders_need_email(founders: list[dict]) -> bool:
    named = [f for f in founders if _text(f.get("name"))]
    if not named:
        return True
    return any(not _text(f.get("email")) for f in named)


def _has_company_meta(row: dict) -> bool:
    return any(_text(row.get(f)) for f in ("founded", "location", "team_size", "stage", "raised"))


@dataclass
class EnrichGaps:
    company_description: bool = False
    company_meta: bool = False  # stage/raised/team/location/founded bundle
    website: bool = False
    founders_timeline: bool = False
    founder_emails: bool = False
    monthly_visits: bool = False
    global_rank: bool = False
    visit_growth: bool = False
    competitors: bool = False
    fiber_employee_count: bool = False
    company_linkedin: bool = False

    def needs_fiber(self) -> bool:
        return any(
            [
                self.company_description,
                self.company_meta,
                self.website,
                self.founders_timeline,
                self.founder_emails,
                self.fiber_employee_count,
                self.company_linkedin,
            ]
        )

    def needs_similarweb(self) -> bool:
        return any(
            [
                self.monthly_visits,
                self.global_rank,
                self.visit_growth,
                self.competitors,
            ]
        )

    def needs_any(self) -> bool:
        return self.needs_fiber() or self.needs_similarweb()

    def signature(self) -> str:
        parts = [k for k, v in self.__dict__.items() if v]
        return ",".join(parts) or "none"


def assess_enrich_gaps(row: dict) -> EnrichGaps:
    founders = _founders_list(row)
    fiber_meta = row.get("fiber_meta") if isinstance(row.get("fiber_meta"), dict) else {}
    web_analytics = row.get("web_analytics") if isinstance(row.get("web_analytics"), dict) else {}
    competitors = row.get("competitors")
    has_competitors = isinstance(competitors, list) and len(competitors) > 0
    has_description = _text(row.get("company_description"))
    has_visits = row.get("monthly_visits") is not None

    need_fiber_company = not has_description or not _has_company_meta(row)

    gaps = EnrichGaps(
        company_description=not has_description,
        company_meta=not _has_company_meta(row) and not has_description,
        website=not _text(row.get("website")),
        founders_timeline=not _founders_have_timeline(founders),
        founder_emails=_founders_have_timeline(founders) and _founders_need_email(founders),
        monthly_visits=not has_visits,
        global_rank=not has_visits and row.get("global_rank") is None,
        visit_growth=not has_visits and web_analytics.get("visit_growth_pct") is None,
        competitors=not has_competitors,
        fiber_employee_count=need_fiber_company and fiber_meta.get("employee_count") is None,
        company_linkedin=need_fiber_company and not _text(fiber_meta.get("company_linkedin")),
    )
    return gaps


def known_context_summary(row: dict) -> str:
    """Short summary of what we already have — passed to Connect so it skips re-fetching."""
    lines: list[str] = []
    if _text(row.get("company_description")):
        lines.append(f"company_description: {_text(row.get('company_description'))[:400]}")
    for field in ("founded", "location", "team_size", "stage", "raised"):
        if _text(row.get(field)):
            lines.append(f"{field}: {_text(row.get(field))}")
    if row.get("monthly_visits") is not None:
        lines.append(f"monthly_visits: {row.get('monthly_visits')}")
    if row.get("global_rank") is not None:
        lines.append(f"global_rank: {row.get('global_rank')}")
    wa = row.get("web_analytics") if isinstance(row.get("web_analytics"), dict) else {}
    if wa.get("visit_growth_pct") is not None:
        lines.append(f"visit_growth_pct: {wa.get('visit_growth_pct')}")
    fm = row.get("fiber_meta") if isinstance(row.get("fiber_meta"), dict) else {}
    if fm.get("employee_count") is not None:
        lines.append(f"employee_count: {fm.get('employee_count')}")
    if _text(fm.get("company_linkedin")):
        lines.append(f"company_linkedin: {_text(fm.get('company_linkedin'))}")
    if _text(row.get("website")):
        lines.append(f"website: {_text(row.get('website'))}")
    founders = _founders_list(row)
    if founders:
        for f in founders[:5]:
            name = _text(f.get("name"))
            if not name:
                continue
            email = _text(f.get("email"))
            pos_count = len(f.get("positions") or [])
            lines.append(f"founder {name}: {pos_count} positions" + (f", email {email}" if email else ""))
    comps = row.get("competitors")
    if isinstance(comps, list) and comps:
        lines.append(f"competitors: {len(comps)} already stored")
    return "\n".join(lines)
