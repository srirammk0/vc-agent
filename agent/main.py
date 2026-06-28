import sys
import json
import asyncio
from pathlib import Path

# Load .env from repo root for local runs (no-op in Trigger.dev where env is injected)
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import logfire
from agent import run_agent

logfire.configure()


def main():
    payload = json.loads(sys.stdin.read())
    result = asyncio.run(run_agent(payload))
    # Only one print to stdout — Trigger.dev parses this as JSON
    print(json.dumps(result))


if __name__ == "__main__":
    main()
