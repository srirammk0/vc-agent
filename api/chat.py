import json
import os
import sys

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

# agent/agent.py imports its siblings (cache, llm, tools.exa, ...) as bare
# top-level modules, not package-relative — same reason modal_app.py inserts
# "/root/agent" onto sys.path before importing. Mirror that here with the
# agent/ dir's real path so `from agent import run_web_chat_stream` resolves
# to agent/agent.py (shadowing the `agent` package) instead of the empty
# agent/__init__.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "agent"))

# Trace this path too — main.py (the SMS/Modal path) already does this, but the
# web-chat path, which is the one reported as sometimes hanging/timing out, had
# zero tracing until now.
import logfire  # noqa: E402
logfire.configure(send_to_logfire="if-token-present")
logfire.instrument_pydantic_ai()

from agent import run_web_chat_stream  # noqa: E402


async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return JSONResponse({"error": "messages required"}, status_code=400)

    async def event_stream():
        async for event in run_web_chat_stream(messages):
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
