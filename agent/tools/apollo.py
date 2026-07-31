"""Apollo.io People API — work email lookup during enrichment.

Docs: https://docs.apollo.io/reference/people-match
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx

try:
    import cache
except ImportError:
    cache = None

_APOLLO_BASE = "https://api.apollo.io/api/v1"
_REQUEST_TIMEOUT_SECONDS = 45.0
_EMAIL_TTL_SECONDS = 7 * 24 * 3600

_JUNK_EMAIL_RE = re.compile(
    r"(example\.com|@unknown|unknown@|notfound|not_found|noreply|noemail|"
    r"invalid|placeholder|@domain\.|test@|unable|undetermined|"
    r"cannot_be|could_not|no_email)",
    re.I,
)


def _api_key() -> str:
    return os.environ.get("APOLLO_API_KEY", "").strip()


def apollo_email_enabled() -> bool:
    return bool(_api_key())


def domain_from_website(website: str) -> str:
    """Normalize a website URL or bare domain to a hostname (no www.)."""
    raw = (website or "").strip()
    if not raw:
        return ""
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    host = (urlparse(raw).hostname or "").strip().lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def split_name(full_name: str) -> tuple[str, str]:
    parts = [p for p in (full_name or "").strip().split() if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[-1]


def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not email or "@" not in email:
        return ""
    if _JUNK_EMAIL_RE.search(email):
        return ""
    local, _, domain = email.rpartition("@")
    if not local or not domain or "." not in domain:
        return ""
    return email[:200]


def _normalize_linkedin(linkedin: str) -> str:
    raw = (linkedin or "").strip()
    if not raw:
        return ""
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    return raw


async def _match_person(payload: dict[str, Any]) -> str:
    key = _api_key()
    if not key:
        return ""

    headers = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": key,
    }

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{_APOLLO_BASE}/people/match",
                headers=headers,
                json=payload,
            )
    except Exception as e:
        print(f"Apollo request failed: {e}")
        return ""

    if resp.status_code == 429:
        print("Apollo rate limited (429)")
        return ""

    try:
        data = resp.json()
    except Exception:
        print(f"Apollo invalid JSON ({resp.status_code})")
        return ""

    if resp.status_code >= 400:
        msg = data.get("message") if isinstance(data, dict) else str(data)[:200]
        print(f"Apollo match failed ({resp.status_code}): {msg}")
        return ""

    person = data.get("person") if isinstance(data, dict) else None
    if not isinstance(person, dict):
        return ""

    email = normalize_email(str(person.get("email") or ""))
    status = (person.get("email_status") or "").strip().lower()
    if email and status in ("verified", "guessed", "unavailable", ""):
        return email
    return email


async def _find_one_email(
    name: str,
    domain: str,
    linkedin: str,
) -> str:
    linkedin = _normalize_linkedin(linkedin)
    if linkedin:
        return await _match_person(
            {
                "linkedin_url": linkedin,
                "reveal_personal_emails": False,
            }
        )

    first, last = split_name(name)
    if not first:
        return ""

    payload: dict[str, Any] = {
        "reveal_personal_emails": False,
    }
    if first:
        payload["first_name"] = first
    if last:
        payload["last_name"] = last
    if domain:
        payload["domain"] = domain

    return await _match_person(payload)


async def find_work_emails(
    founders: list[Any],
    domain: str,
) -> list[str]:
    """Find work emails for up to 5 founders via Apollo people/match.

    founders: objects with .name and optional .linkedin (FounderProfile-like).
    domain: company domain (e.g. clay.com), not a full URL.
    Returns a list of emails aligned with founders (empty string when not found).
    """
    domain = (domain or "").strip().lower()
    if not apollo_email_enabled():
        return [""] * len(founders)

    emails = [""] * len(founders)
    uncached_indices: list[int] = []

    if cache is not None:
        for i, founder in enumerate(founders):
            name = (getattr(founder, "name", None) or "").strip()
            linkedin = (getattr(founder, "linkedin", None) or "").strip()
            if not name and not linkedin:
                continue
            key = cache.make_key(
                "apollo:work_email",
                f"{domain}|{name}|{linkedin}",
            )
            cached = await cache.cache_get(key, _EMAIL_TTL_SECONDS)
            if cached is not None and isinstance(cached, str):
                emails[i] = normalize_email(cached)
            else:
                uncached_indices.append(i)
    else:
        uncached_indices = list(range(len(founders)))

    if uncached_indices:
        tasks = []
        for i in uncached_indices:
            founder = founders[i]
            name = (getattr(founder, "name", None) or "").strip()
            linkedin = (getattr(founder, "linkedin", None) or "").strip()
            tasks.append(_find_one_email(name, domain, linkedin))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, result in zip(uncached_indices, results):
            if isinstance(result, Exception):
                print(f"Apollo email lookup failed for founder {i}: {result}")
                continue
            email = normalize_email(str(result or ""))
            emails[i] = email
            if cache is not None:
                founder = founders[i]
                name = (getattr(founder, "name", None) or "").strip()
                linkedin = (getattr(founder, "linkedin", None) or "").strip()
                key = cache.make_key(
                    "apollo:work_email",
                    f"{domain}|{name}|{linkedin}",
                )
                await cache.cache_set(key, email)

    return emails
