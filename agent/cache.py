"""Lightweight Supabase-backed cache for Exa results and LLM outputs.

No external services: reuses the Supabase project already configured via the
Modal secret. All failures degrade gracefully (a cache miss never breaks the
caller).

Requires a table:

    CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
    );
    GRANT ALL PRIVILEGES ON TABLE cache TO postgres, service_role, anon, authenticated;
"""

import os
import json
import hashlib
import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

_client = None


def _get_client():
    global _client
    if _client is None:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or ""
        if not url or not key:
            return None
        _client = create_client(url, key)
    return _client


def make_key(namespace: str, payload: str) -> str:
    h = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
    return f"{namespace}:{h}"


def _get_sync(key: str, ttl_seconds: int) -> Optional[Any]:
    client = _get_client()
    if client is None:
        return None
    try:
        res = client.table("cache").select("value, created_at").eq("key", key).maybe_single().execute()
        row = getattr(res, "data", None)
        if not row:
            return None
        created_at = row.get("created_at")
        if created_at and ttl_seconds > 0:
            ts = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - ts).total_seconds()
            if age > ttl_seconds:
                return None
        return row.get("value")
    except Exception as e:
        print("cache get failed:", e)
        return None


def _set_sync(key: str, value: Any) -> None:
    client = _get_client()
    if client is None:
        return
    try:
        client.table("cache").upsert({
            "key": key,
            "value": value,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        print("cache set failed:", e)


async def cache_get(key: str, ttl_seconds: int) -> Optional[Any]:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_get_sync, key, ttl_seconds), timeout=10.0
        )
    except Exception:
        return None


async def cache_set(key: str, value: Any) -> None:
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_set_sync, key, value), timeout=10.0
        )
    except Exception:
        pass


def _delete_sync(key: str) -> None:
    client = _get_client()
    if client is None:
        return
    try:
        client.table("cache").delete().eq("key", key).execute()
    except Exception as e:
        print("cache delete failed:", e)


async def cache_delete(key: str) -> None:
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_delete_sync, key), timeout=10.0
        )
    except Exception:
        pass


def cache_get_sync(key: str, ttl_seconds: int) -> Optional[Any]:
    return _get_sync(key, ttl_seconds)


def cache_set_sync(key: str, value: Any) -> None:
    _set_sync(key, value)
