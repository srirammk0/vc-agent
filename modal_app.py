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
            data=json.dumps({
                "number": num,
                "content": content,
                "from_number": os.environ.get("SENDBLUE_FROM_NUMBER", "")
            }).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        urllib.request.urlopen(req)
    except Exception as e:
        print("Failed to send SendBlue SMS", e)
        if hasattr(e, "read"):
            print("Response body:", e.read().decode("utf-8"))


# --- Scheduled scout: every 4 hours ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    schedule=modal.Cron("0 */4 * * *"),
    timeout=180,
)
def scout_scheduled():
    res = run_agent({"mode": "scout"})
    send_sms(f"Scheduled sweep complete. Found {res.get('found', 0)} new startups.")
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


# --- Background task: SendBlue reply ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
    min_containers=1,
)
def chat_reply_background(message: str, sender: str, message_handle: str = None):
    # Run agent to get response (which handles typing internally via lifecycle hooks)
    result = run_agent({"mode": "text", "message": message, "sender": sender})
    reply = result.get("reply", "")
    
    # Send outbound SMS reply
    if reply:
        send_sms(reply)

# --- SendBlue inbound webhook: yes/no replies ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=60,
    min_containers=1,
)
@modal.fastapi_endpoint(method="POST")
async def sendblue_webhook(request: dict):
    body = request
    
    if body.get("is_outbound"):
        return {"ok": True, "action": "ignored", "reason": "outbound"}

    message = body.get("content", "").strip()
    if not message:
        return {"ok": True, "action": "ignored", "reason": "empty"}

    import os
    owner_raw = os.environ.get("ALERT_PHONE_NUMBER", "")
    owner = "".join(filter(str.isdigit, owner_raw))
    sender_raw = body.get("from_number") or body.get("number") or ""
    sender = "".join(filter(str.isdigit, sender_raw))
    
    if owner and sender and not sender.endswith(owner[-10:]):
        return {"ok": True, "action": "ignored", "reason": "unauthorized"}

    message_handle = body.get("message_handle")

    # Spawn the background task and return immediately
    await chat_reply_background.spawn.aio(message, sender_raw, message_handle)
    return {"ok": True, "runId": "spawned"}

