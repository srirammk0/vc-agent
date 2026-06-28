import sys
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

from agent import run_agent
logfire.instrument_pydantic_ai()


def main():
    payload = json.loads(sys.stdin.read())
    result = asyncio.run(run_agent(payload))
    # Only one print to stdout — Trigger.dev parses this as JSON
    print(json.dumps(result))


if __name__ == "__main__":
    main()
