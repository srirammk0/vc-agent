"""Clay Public API — work email enrichment via Clay-managed routines.

Docs: https://developers.clay.com/routines/api
Recipe: https://developers.clay.com/recipes/search-and-enrich
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

try:
    import cache
except ImportError:
    cache = None

CLAY_BASE = "https://api.clay.com/public/v0"
_EMAIL_TTL_SECONDS = 7 * 24 * 3600
_POLL_INTERVAL_SECONDS = 2.0
_POLL_TIMEOUT_SECONDS = 180.0
_REQUEST_TIMEOUT_SECONDS = 45.0

_EMAIL_KEY_HINTS = (
    "email",
    "work_email",
    "work email",
    "primary_email",
    "validated_email",
    "email_address",
)

_JUNK_EMAIL_RE = re.compile(
    r"(example\.com|@unknown|unknown@|notfound|not_found|noreply|noemail|"
    r"invalid|placeholder|@domain\.|test@|unable|undetermined|"
    r"cannot_be|could_not|no_email)",
    re.I,
)


def _api_key() -> str:
    return (
        os.environ.get("CLAY_API_KEY", "").strip()
        or os.environ.get("CLAY_PUBLIC_API_KEY", "").strip()
    )


def _work_email_routine_id() -> str:
    return os.environ.get("CLAY_WORK_EMAIL_ROUTINE_ID", "").strip()


def clay_email_enabled() -> bool:
    return bool(_api_key() and _work_email_routine_id())


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


def _extract_email_from_result(result: Any) -> str:
    if result is None:
        return ""
    if isinstance(result, str):
        return normalize_email(result)
    if not isinstance(result, dict):
        return ""

    for key in _EMAIL_KEY_HINTS:
        if key in result:
            found = normalize_email(str(result.get(key) or ""))
            if found:
                return found

    for value in result.values():
        if isinstance(value, str) and "@" in value:
            found = normalize_email(value)
            if found:
                return found
        if isinstance(value, dict):
            found = _extract_email_from_result(value)
            if found:
                return found
        if isinstance(value, list):
            for item in value:
                found = _extract_email_from_result(item)
                if found:
                    return found
    return ""


def _build_inputs(
    full_name: str,
    domain: str,
    linkedin: str = "",
) -> dict[str, str]:
    first, last = split_name(full_name)
    inputs: dict[str, str] = {
        "domain": domain,
        "full_name": full_name.strip(),
        "first_name": first,
        "last_name": last,
    }
    if first and not last:
        inputs["name"] = first
    linkedin = (linkedin or "").strip()
    if linkedin:
        if not linkedin.startswith(("http://", "https://")):
            linkedin = f"https://{linkedin}"
        inputs["linkedin_url"] = linkedin
        inputs["linkedin"] = linkedin
    return inputs


async def _request(
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
) -> tuple[int, dict | str]:
    key = _api_key()
    if not key:
        return 0, "CLAY_API_KEY not set"

    url = f"{CLAY_BASE}{path}"
    headers = {"clay-api-key": key, "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.request(method, url, headers=headers, json=json_body)
    except Exception as e:
        return 0, f"Clay request failed: {e}"

    if resp.status_code == 429:
        return resp.status_code, "Clay rate limited (429)"

    try:
        data = resp.json()
    except Exception:
        data = resp.text[:500]

    if resp.status_code >= 400:
        msg = data.get("message") if isinstance(data, dict) else str(data)
        return resp.status_code, msg or f"Clay HTTP {resp.status_code}"

    return resp.status_code, data


async def _start_routine_run(routine_id: str, items: list[dict]) -> str | None:
    rid = routine_id.strip()
    if not rid.startswith("function:"):
        rid = f"function:{rid}"

    status, data = await _request(
        "POST",
        f"/routines/{rid}/run",
        json_body={"items": items},
    )
    if status != 200 or not isinstance(data, dict):
        print(f"Clay routine start failed ({status}): {data}")
        return None

    run_id = (data.get("routine_run_id") or "").strip()
    if not run_id:
        print("Clay routine start returned no routine_run_id")
        return None
    return run_id


async def _poll_run_results(run_id: str) -> dict[str, dict]:
    """Poll until complete; return {item_id: result_dict} for successful items."""
    deadline = asyncio.get_running_loop().time() + _POLL_TIMEOUT_SECONDS
    cursor: str | None = None
    by_id: dict[str, dict] = {}

    while asyncio.get_running_loop().time() < deadline:
        path = f"/routines/run/{run_id}/results"
        if cursor:
            path = f"{path}?cursor={cursor}&limit=100"
        else:
            path = f"{path}?limit=100"

        status, data = await _request("GET", path)
        if status == 202 and isinstance(data, dict):
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
            continue
        if status != 200 or not isinstance(data, dict):
            print(f"Clay poll failed ({status}): {data}")
            return by_id

        if data.get("status") == "in_progress":
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
            continue

        for item in data.get("data") or []:
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "")
            if item.get("status") == "complete" and isinstance(item.get("result"), dict):
                by_id[item_id] = item["result"]
            elif item.get("status") == "failed":
                err = item.get("error") or {}
                msg = err.get("message") if isinstance(err, dict) else str(err)
                print(f"Clay item {item_id} failed: {msg}")

        cursor = data.get("cursor")
        if cursor:
            continue
        break

    return by_id


async def find_work_emails(
    founders: list[Any],
    domain: str,
) -> list[str]:
    """Find work emails for up to 5 founders via Clay's Work Email routine.

    founders: objects with .name and optional .linkedin (FounderProfile-like).
    domain: company domain (e.g. clay.com), not a full URL.
    Returns a list of emails aligned with founders (empty string when not found).
    """
    domain = (domain or "").strip().lower()
    if not domain:
        return [""] * len(founders)

    routine_id = _work_email_routine_id()
    if not clay_email_enabled():
        if _api_key() and not routine_id:
            print(
                "Clay email skipped: set CLAY_WORK_EMAIL_ROUTINE_ID "
                "(find via `clay routines list` → Work Email routine id)"
            )
        return [""] * len(founders)

    items: list[dict] = []
    index_map: list[int] = []

    for i, founder in enumerate(founders):
        name = (getattr(founder, "name", None) or "").strip()
        if not name:
            continue
        linkedin = (getattr(founder, "linkedin", None) or "").strip()
        item_id = f"founder-{i}"
        items.append(
            {
                "id": item_id,
                "inputs": _build_inputs(name, domain, linkedin),
            }
        )
        index_map.append(i)

    if not items:
        return [""] * len(founders)

    cache_hits: dict[int, str] = {}
    uncached_items: list[dict] = []
    uncached_indices: list[int] = []

    if cache is not None:
        for item in items:
            idx = int(item["id"].split("-", 1)[1])
            founder = founders[idx]
            name = (getattr(founder, "name", None) or "").strip()
            linkedin = (getattr(founder, "linkedin", None) or "").strip()
            key = cache.make_key(
                "clay:work_email",
                f"{domain}|{name}|{linkedin}",
            )
            cached = await cache.cache_get(key, _EMAIL_TTL_SECONDS)
            if cached is not None and isinstance(cached, str):
                cache_hits[idx] = normalize_email(cached)
            else:
                uncached_items.append(item)
                uncached_indices.append(idx)
    else:
        uncached_items = items
        uncached_indices = index_map

    results_by_id: dict[str, dict] = {}
    if uncached_items:
        run_id = await _start_routine_run(routine_id, uncached_items)
        if run_id:
            results_by_id = await _poll_run_results(run_id)

    emails = [""] * len(founders)

    for idx, email in cache_hits.items():
        emails[idx] = email

    for item in uncached_items:
        idx = int(item["id"].split("-", 1)[1])
        result = results_by_id.get(item["id"], {})
        email = _extract_email_from_result(result)
        emails[idx] = email
        if cache is not None:
            founder = founders[idx]
            name = (getattr(founder, "name", None) or "").strip()
            linkedin = (getattr(founder, "linkedin", None) or "").strip()
            key = cache.make_key("clay:work_email", f"{domain}|{name}|{linkedin}")
            await cache.cache_set(key, email)

    return emails
