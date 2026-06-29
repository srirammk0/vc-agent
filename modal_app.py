import modal
import json
import subprocess
import threading
import time
from pathlib import Path

app = modal.App("vc-scout")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "pydantic-ai[openai]",
        "openai",
        "exa-py",
        "logfire[pydantic-ai]",
        "python-dotenv",
        "fastapi",
        "supabase",
        "supermemory",
    )
    .add_local_dir("./agent", remote_path="/root/agent")
)

def run_agent(payload: dict) -> dict:
    result = subprocess.run(
        ["python3", "/root/agent/main.py"],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=1200,
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


def _e164(phone: str | None) -> str | None:
    if not phone:
        return None
    phone = phone.strip()
    if phone.startswith("+"):
        return phone
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}" if digits else None


def send_typing(number: str, state: str = "start"):
    import urllib.request
    import json
    import os

    recipient = _e164(number)
    from_number = _e164(os.environ.get("SENDBLUE_FROM_NUMBER", ""))
    if not recipient or not from_number:
        return

    headers = {
        "sb-api-key-id": os.environ.get("SENDBLUE_API_KEY", ""),
        "sb-api-secret-key": os.environ.get("SENDBLUE_API_SECRET", ""),
        "Content-Type": "application/json",
    }
    body = {
        "number": recipient,
        "from_number": from_number,
        "state": state,
    }
    if state == "start":
        body["max_duration_ms"] = 300000

    try:
        req = urllib.request.Request(
            "https://api.sendblue.co/api/send-typing-indicator",
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        urllib.request.urlopen(req)
    except Exception as e:
        print("Failed to send typing indicator", e)
        if hasattr(e, "read"):
            print("Response body:", e.read().decode("utf-8"))


def _start_typing_loop(recipient: str) -> tuple[threading.Event, threading.Thread]:
    """Refresh SendBlue typing every ~3s until stop_event is set."""
    stop_event = threading.Event()

    def loop():
        while not stop_event.is_set():
            send_typing(recipient, "start")
            for _ in range(30):
                if stop_event.is_set():
                    break
                time.sleep(0.1)

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()
    return stop_event, thread


def _stop_typing_loop(
    recipient: str | None,
    stop_event: threading.Event | None,
    thread: threading.Thread | None,
) -> None:
    if stop_event:
        stop_event.set()
    if thread:
        thread.join(timeout=5)
    if recipient:
        send_typing(recipient, "stop")


# --- Scheduled scout: every 4 hours (4-turn reflection loop) ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    schedule=modal.Cron("0 */4 * * *"),
    timeout=1200,
    min_containers=1,
)
def scout_scheduled():
    res = run_agent({"mode": "scout"})
    reply = res.get("reply", "Sweep finished with no report.")
    send_sms(f"Scheduled sweep complete.\n\nAgent Report:\n{reply}")
    sync_on_demand.spawn()
    return res


# --- Sync: mirror Supermemory -> Supabase ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    schedule=modal.Cron("*/30 * * * *"),
    timeout=300,
)
def sync_scheduled():
    import sys
    sys.path.insert(0, "/root/agent")
    from sync import sync
    sync()


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
)
def sync_on_demand():
    import sys
    sys.path.insert(0, "/root/agent")
    from sync import sync
    sync()


# --- Enrichment: triggered by dashboard, writes directly to Supabase (no agent) ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def enrich_startup(payload: dict):
    import sys
    import os
    import asyncio
    sys.path.insert(0, "/root/agent")
    from tools.exa import search_company, search_people
    from supabase import create_client

    slug = payload.get("slug")
    name = payload.get("name")

    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    sb.table("startups").update({"enrichment_status": "running"}).eq("slug", slug).execute()

    try:
        company = asyncio.run(search_company(f"{name} startup company"))
        people = asyncio.run(search_people(f"founder CEO {name}"))

        from enrich import structure_enrichment, has_enrichment_content

        structured = asyncio.run(structure_enrichment(name, company, people))

        if not structured or not has_enrichment_content(structured):
            sb.table("startups").update({"enrichment_status": "pending"}).eq("slug", slug).execute()
            return {"status": "no_data", "slug": slug}

        founders = [
            {
                "name": f.name,
                "background": f.background[:500],
                "linkedin": f.linkedin or "",
            }
            for f in structured.founders[:5]
        ]

        sb.table("startups").update({
            "company_description": structured.company_description[:1500],
            "founded": structured.founded,
            "location": structured.location,
            "team_size": structured.team_size,
            "stage": structured.stage,
            "raised": structured.raised,
            "founders": founders,
            "enrichment_status": "complete",
        }).eq("slug", slug).execute()
    except Exception as e:
        sb.table("startups").update({"enrichment_status": "pending"}).eq("slug", slug).execute()
        return {"status": "error", "slug": slug, "error": str(e)}

    return {"status": "enriched", "slug": slug}


# --- Background task: SendBlue reply ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=1200,
    min_containers=1,
)
def chat_reply_background(message: str, sender: str, message_handle: str = None):
    import os
    recipient = _e164(sender) or _e164(os.environ.get("ALERT_PHONE_NUMBER", ""))
    stop_event = None
    typing_thread = None
    if recipient:
        stop_event, typing_thread = _start_typing_loop(recipient)

    try:
        result = run_agent({
            "mode": "text",
            "message": message,
            "sender": sender,
            "message_handle": message_handle,
        })
        reply = result.get("reply", "")
        if reply:
            send_sms(reply)
        sync_on_demand.spawn()
    except Exception as e:
        print("chat_reply_background failed:", e)
        send_sms("something broke on my end - try again in a min")
    finally:
        _stop_typing_loop(recipient, stop_event, typing_thread)

# --- SendBlue inbound webhook: yes/no replies ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=1200,
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

