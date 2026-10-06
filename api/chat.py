import hashlib
import hmac
import json
import os
import sys
import time

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

# agent/agent.py imports its siblings (cache, llm, tools.exa, ...) as bare
# top-level modules, not package-relative — same reason agent/main.py (run via
# Trigger.dev's python.runScript) needs its own directory on sys.path. Mirror
# that here with the agent/ dir's real path so `from agent import
# run_web_chat_stream` resolves to agent/agent.py (shadowing the `agent`
# package) instead of the empty agent/__init__.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "agent"))

# Trace this path too — main.py (the Trigger.dev path) already does this, but the
# web-chat path, which is the one reported as sometimes hanging/timing out, had
# zero tracing until now.
import logfire  # noqa: E402
logfire.configure(send_to_logfire="if-token-present")
logfire.instrument_pydantic_ai()

from agent import run_web_chat_stream  # noqa: E402


_SESSION_COOKIE = "vc_auth"


def _is_authenticated(request: Request) -> bool:
    """Verify the dashboard's signed session cookie (src/lib/auth.ts).

    This endpoint is a Vercel Python function, not a Next route, so src/proxy.ts
    never runs for it — without this check the endpoint was open to the internet,
    and it drives an agent holding save_startups/delete_startups/update_thesis/
    schedule_agent_run plus paid Exa and Anthropic keys.

    Token format: v1.<unix-expiry>.<hex hmac-sha256 of "v1.<unix-expiry>">, keyed
    by DASHBOARD_SESSION_SECRET. Keep in sync with src/lib/auth.ts.
    """
    secret = os.environ.get("DASHBOARD_SESSION_SECRET", "")
    token = request.cookies.get(_SESSION_COOKIE, "")
    if not secret or not token:
        return False

    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        return False
    _, exp_raw, sig = parts
    try:
        exp = int(exp_raw)
    except ValueError:
        return False
    if exp <= time.time():
        return False

    expected = hmac.new(
        secret.encode("utf-8"), f"v1.{exp_raw}".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(sig, expected)


async def chat(request: Request):
    # Kill switch: set AGENT_DISABLED=1 in Vercel env to take the agent offline
    # while the rest of the dashboard stays up.
    if os.environ.get("AGENT_DISABLED"):
        return JSONResponse({"error": "agent is disabled"}, status_code=503)
    if not _is_authenticated(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    body = await request.json()
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return JSONResponse({"error": "messages required"}, status_code=400)

    async def event_stream():
        # request.is_disconnected() lets the agent notice a client-side abort
        # (the web UI's Stop button, or the tab closing) and stop issuing further
        # model/tool calls instead of running the whole turn to completion with
        # nobody left to read the reply — see run_web_chat_stream's should_stop.
        async for event in run_web_chat_stream(messages, should_stop=request.is_disconnected):
            yield f"data: {json.dumps(event)}\n\n".encode("utf-8")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


app = Starlette(routes=[Route("/api/chat", chat, methods=["POST"])])
