import modal
import json
import subprocess
import threading
import time

app = modal.App("vc-scout")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "pydantic-ai[anthropic]",
        "exa-py",
        "httpx",
        "logfire[pydantic-ai]",
        "python-dotenv",
        "fastapi",
        "supabase",
        "supermemory==3.12.1",
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


def _check_scheduler_secret(payload: dict) -> None:
    """Guards endpoints only Trigger.dev's scheduler should call — these used to be
    Modal-cron-only (unreachable from the internet) and became HTTP-callable to let
    Trigger.dev own scheduling, so this closes the gap that opened up."""
    import os
    from fastapi import HTTPException

    expected = os.environ.get("SCHEDULER_SHARED_SECRET", "")
    if not expected or (payload or {}).get("secret") != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


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


def _phone_digits(phone: str | None) -> str:
    return "".join(c for c in (phone or "") if c.isdigit())


def _parse_phone_list(raw: str) -> list[str]:
    if not raw.strip():
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def allowed_phone_numbers() -> list[str]:
    """Numbers allowed to text the agent. Falls back to ALERT_PHONE_NUMBER."""
    import os

    allowed = _parse_phone_list(os.environ.get("ALLOWED_PHONE_NUMBERS", ""))
    if allowed:
        return allowed
    alert = os.environ.get("ALERT_PHONE_NUMBER", "").strip()
    return [alert] if alert else []


def notify_phone_numbers() -> list[str]:
    """Numbers that receive scheduled scout/brief texts. Falls back to ALERT_PHONE_NUMBER."""
    import os

    notify = _parse_phone_list(os.environ.get("NOTIFY_PHONE_NUMBERS", ""))
    if notify:
        return notify
    alert = os.environ.get("ALERT_PHONE_NUMBER", "").strip()
    return [alert] if alert else []


def is_authorized_sender(sender: str | None) -> bool:
    allowed = allowed_phone_numbers()
    if not allowed:
        return True
    sender_digits = _phone_digits(sender)
    if not sender_digits:
        return False
    for num in allowed:
        digits = _phone_digits(num)
        if digits and sender_digits.endswith(digits[-10:]):
            return True
    return False


def send_sms(content: str, to: str | None = None):
    import urllib.request
    import json
    import os

    recipients = [_e164(to)] if to else [_e164(n) for n in notify_phone_numbers()]
    recipients = [r for r in recipients if r]
    if not recipients:
        return

    headers = {
        "sb-api-key-id": os.environ.get("SENDBLUE_API_KEY", ""),
        "sb-api-secret-key": os.environ.get("SENDBLUE_API_SECRET", ""),
        "Content-Type": "application/json",
    }
    from_number = os.environ.get("SENDBLUE_FROM_NUMBER", "")

    for num in recipients:
        try:
            req = urllib.request.Request(
                "https://api.sendblue.co/api/send-message",
                data=json.dumps({
                    "number": num,
                    "content": content,
                    "from_number": from_number,
                }).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            urllib.request.urlopen(req)
        except Exception as e:
            print(f"Failed to send SendBlue SMS to {num}", e)
            if hasattr(e, "read"):
                print("Response body:", e.read().decode("utf-8"))


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


# --- Sync: mirror Supermemory -> Supabase. Scheduling owned by Trigger.dev ---
# --- (cron */30 * * * *, src/trigger/sync.ts) — this is now a plain hardened  ---
# --- HTTP endpoint, not a Modal cron.                                        ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def sync_scheduled(payload: dict):
    _check_scheduler_secret(payload)
    import sys
    sys.path.insert(0, "/root/agent")
    from sync import sync
    sync()
    return {"status": "ok"}


# --- Scheduled-check dispatch: fired by Trigger.dev's run-scheduled-check task ---
# --- when a one-off delayed trigger comes due (follow-up texts, daily          ---
# --- portfolio checks). This is how self-scheduling actually fires now — see   ---
# --- agent/trigger_client.py for how these get scheduled.                      ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=600,
)
@modal.fastapi_endpoint(method="POST")
def run_scheduled_check(payload: dict):
    _check_scheduler_secret(payload)
    import sys
    import asyncio
    sys.path.insert(0, "/root/agent")

    kind = payload.get("kind")
    try:
        if kind == "text_followup":
            sender = payload.get("sender")
            instructions = payload.get("instructions")
            if sender and instructions:
                chat_reply_background.spawn(instructions, sender)
        elif kind == "daily_check":
            from daily_planner import run_daily_check
            notify = asyncio.run(run_daily_check(payload))
            if notify:
                send_sms(notify)
                run_agent({
                    "mode": "append_alert",
                    "message": notify,
                    "recipients": notify_phone_numbers(),
                })
        else:
            print(f"run_scheduled_check: unknown kind {kind!r}")
    except Exception as e:
        print(f"run_scheduled_check: task kind={kind} failed:", e)

    try:
        from scheduled_tasks_log import mark_done
        mark_done(payload.get("_task_id"))
    except Exception as e:
        print("run_scheduled_check: mark_done failed:", e)

    return {"status": "ok"}


# --- Daily planner: once each morning, decides which approved-but-quiet     ---
# --- startups deserve a fresh look today and schedules each via Trigger.dev ---
# --- (agent/daily_planner.py). Scheduling owned by Trigger.dev (cron        ---
# --- 0 6 * * * America/New_York, src/trigger/daily-planner.ts).             ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=600,
)
@modal.fastapi_endpoint(method="POST")
def daily_planner_scheduled(payload: dict):
    _check_scheduler_secret(payload)
    import sys
    import asyncio
    sys.path.insert(0, "/root/agent")
    from daily_planner import run_daily_planner
    asyncio.run(run_daily_planner())
    return {"status": "ok"}


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


# --- Web chat: separate chat surface for the dashboard website — no shared memory ---
# --- with the iMessage thread. The client owns the full conversation; each call    ---
# --- builds a fresh agent from the {"messages": [...]} array it's given.           ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def run_web_chat(payload: dict):
    import sys
    import asyncio
    sys.path.insert(0, "/root/agent")
    from agent import run_web_chat as _run_web_chat

    messages = payload.get("messages", [])
    reply = asyncio.run(_run_web_chat(messages))
    return {"reply": reply}


# --- Enrichment: triggered by dashboard, writes directly to Supabase (no agent) ---
# The web endpoint returns immediately and spawns the real work, so the dashboard
# (and Vercel's short function timeout) never blocks on the full ~10-30s job.
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=60,
)
@modal.fastapi_endpoint(method="POST")
def enrich_startup(payload: dict):
    import os
    from supabase import create_client

    slug = payload.get("slug")
    name = payload.get("name")

    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    sb.table("startups").update({"enrichment_status": "running"}).eq("slug", slug).execute()

    enrich_startup_job.spawn(slug, name)
    return {"status": "started", "slug": slug}


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
)
def enrich_startup_job(slug: str, name: str):
    import sys
    import os
    import asyncio
    sys.path.insert(0, "/root/agent")
    from tools.exa import search_company, search_people
    from supabase import create_client

    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

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


# --- Dashboard feedback: distill approve/pass reasons into Supermemory ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def submit_feedback(payload: dict):
    slug = payload.get("slug")
    name = payload.get("name", "")
    status = payload.get("status", "new")
    message = payload.get("message", "")

    if not slug or not (message or "").strip():
        return {"error": "slug and message required"}

    result = run_agent({
        "mode": "feedback",
        "slug": slug,
        "name": name,
        "status": status,
        "message": message,
    })
    sync_on_demand.spawn()
    return result


# --- Send Signal to Agent ---
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("vc-scout-secrets")],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def send_signal_to_agent(payload: dict):
    signal_id = payload.get("id")
    if not signal_id:
        return {"error": "signal id required"}

    import os
    from supabase import create_client
    
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    
    resp = sb.table("signals").select("*").eq("id", signal_id).single().execute()
    signal = resp.data
    
    if not signal:
        return {"error": "signal not found"}

    message = f"Please research this startup: {signal['title']}. Source: {signal['source_url']}. Snippet: {signal['snippet']}"

    # Spawn in background so dashboard doesn't wait
    chat_reply_background.spawn(message, os.environ.get("ALERT_PHONE_NUMBER", ""))
    
    return {"status": "sent"}


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
        if reply and recipient:
            send_sms(reply, to=recipient)
        sync_on_demand.spawn()
    except Exception as e:
        print("chat_reply_background failed:", e)
        if recipient:
            send_sms("something broke on my end - try again in a min", to=recipient)
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

    sender_raw = body.get("from_number") or body.get("number") or ""

    if not is_authorized_sender(sender_raw):
        return {"ok": True, "action": "ignored", "reason": "unauthorized"}

    message_handle = body.get("message_handle")

    # Spawn the background task and return immediately
    await chat_reply_background.spawn.aio(message, sender_raw, message_handle)
    return {"ok": True, "runId": "spawned"}

