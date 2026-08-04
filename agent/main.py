import sys

# Redirect stdout before any import that might print — Trigger.dev parses the final
# JSON line from stdout via python.runScript.
if __name__ == "__main__":
    sys.stdout = sys.stderr

import json
import asyncio
import os
from pathlib import Path

# Trigger.dev injects OTEL attrs that break logfire's parser
os.environ.pop("OTEL_RESOURCE_ATTRIBUTES", None)

# Load .env from repo root for local runs (no-op in Trigger.dev where env is injected)
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import logfire
logfire.configure(send_to_logfire="if-token-present")

import observability
from agent import run_agent
logfire.instrument_pydantic_ai()


def main():
    # Payload comes as the first CLI arg (Trigger.dev python.runScript) or stdin (local)
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    payload = json.loads(raw)

    real_stdout = sys.__stdout__
    mode = payload.get("mode", "unknown")
    try:
        # Per-run Logfire span covering every mode (enrich, scheduled_run,
        # feedback, daily_morning, fiber_sourcing, requeue_enrichment, ...), in
        # addition to the pydantic-ai / llm spans already emitted.
        with observability.span("agent.run", mode=mode, slug=payload.get("slug", "")) as s:
            result = asyncio.run(run_agent(payload))
            s.set_attribute("summary", str(result)[:600])
            # Only one print to real stdout — the caller parses the last line as JSON
            real_stdout.write(json.dumps(result) + "\n")
            real_stdout.flush()
    finally:
        pass


if __name__ == "__main__":
    main()
