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
        "fastapi",
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


def send_sms(content: str):
    import urllib.request
    import json
    import os
    num = os.environ.get("ALERT_PHONE_NUMBER", "")
    if not num:
        return
    headers = {
        "sb-api-key-id": os.environ.get("SENDBLUE_API_KEY", ""),
        "sb-api-secret-key": os.environ.get("SENDBLUE_API_SECRET", ""),
        "Content-Type": "application/json",
    }
    try:
        req = urllib.request.Request(
            "https://api.sendblue.co/api/send-message",
            data=json.dumps({"number": num, "content": content}).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        urllib.request.urlopen(req)
    except Exception as e:
        print("Failed to send SendBlue SMS", e)


# --- Scheduled scout: 7am + 6pm PT daily ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    schedule=modal.Cron("0 7,18 * * *"),
    timeout=180,
)
def scout_scheduled():
    res = run_agent({"mode": "scout"})
    send_sms(f"Scheduled sweep complete. Found {res.get('found', 0)} new startups.")
    return res



# --- On-demand: called from dashboard "Run Now" ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=180,
)
@modal.fastapi_endpoint(method="POST")
def scout_on_demand(payload: dict = {}):
    res = run_agent({"mode": "scout", **payload})
    send_sms(f"Manual sweep complete. Found {res.get('found', 0)} new startups.")
    return res


# --- Enrichment: called on approval ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=180,
)
@modal.fastapi_endpoint(method="POST")
def enrich_startup(payload: dict):
    res = run_agent({"mode": "enrich", "slug": payload.get("slug")})
    send_sms(f"Enriched startup: {payload.get('slug')}")
    return res


# --- SendBlue inbound webhook: yes/no replies ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=60,
)
@modal.fastapi_endpoint(method="POST")
def sendblue_webhook(payload: dict):
    import urllib.request
    import json
    import os
    
    # 1. Send typing indicator immediately
    num = os.environ.get("ALERT_PHONE_NUMBER", "")
    headers = {
        "sb-api-key-id": os.environ.get("SENDBLUE_API_KEY", ""),
        "sb-api-secret-key": os.environ.get("SENDBLUE_API_SECRET", ""),
        "Content-Type": "application/json",
    }
    try:
        urllib.request.urlopen(urllib.request.Request(
            "https://api.sendblue.co/api/send-typing-indicator",
            data=json.dumps({"number": num}).encode("utf-8"),
            headers=headers,
            method="POST"
        ))
    except Exception:
        pass

    # 2. Run agent to get response
    result = run_agent({"mode": "text", "message": payload.get("content", "")})
    reply = result.get("reply", "")
    
    # 3. Send outbound SMS reply
    if reply:
        send_sms(reply)
        
    return result
