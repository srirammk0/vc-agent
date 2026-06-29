import modal
import json
import subprocess
from pathlib import Path

app = modal.App("vc-scout")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "pydantic-ai[openai]",
        "openai",
        "exa-py",
        "firecrawl-py",
        "logfire[pydantic-ai]",
        "python-dotenv",
    )
    .add_local_dir("./agent", remote_path="/root/agent")
    .add_local_dir("./brain", remote_path="/root/brain")
)

def run_agent(payload: dict) -> dict:
    result = subprocess.run(
        ["python3", "/root/agent/main.py"],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise Exception(f"Agent failed: {result.stderr}")
    return json.loads(result.stdout)


# --- Scheduled scout: 7am + 6pm PT daily ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    schedule=modal.Cron("0 7,18 * * *"),
    timeout=180,
)
def scout_scheduled():
    return run_agent({"mode": "scout"})


# --- Social monitor: every 4 hours ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    schedule=modal.Cron("0 */4 * * *"),
    timeout=60,
)
def social_monitor():
    return run_agent({"mode": "scout"})


# --- On-demand: called from dashboard "Run Now" ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=180,
)
@modal.fastapi_endpoint(method="POST")
def scout_on_demand(payload: dict = {}):
    return run_agent({"mode": "scout", **payload})


# --- Enrichment: called on approval ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=180,
)
@modal.fastapi_endpoint(method="POST")
def enrich_startup(payload: dict):
    return run_agent({"mode": "enrich", "slug": payload.get("slug")})


# --- SendBlue inbound webhook: yes/no replies ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=60,
)
@modal.fastapi_endpoint(method="POST")
def sendblue_webhook(payload: dict):
    # SendBlue sends the message in the "content" field
    return run_agent({"mode": "text", "message": payload.get("content", "")})
