# VC Research Agent

Automated pre-seed/seed AI startup scout. A set of Pydantic AI agents (Anthropic Claude Sonnet) research and
save early-stage AI companies and text you about it — persisted to **Supermemory** (the agent's brain) and
mirrored to **Supabase** for a live Next.js dashboard. Most agentic work — LLM calls, SMS — runs on **Modal**;
**Trigger.dev** owns scheduling only (fixed crons and one-off delayed triggers), calling into Modal's HTTP
endpoints at the right time. A separate web chat surface (dashboard-side, no shared memory with the iMessage
thread) runs directly on Vercel instead (`api/chat.py`, streaming via `run_web_chat_stream`) — no Modal hop,
no cold starts, real token streaming plus a live tool-call trace in the UI.

**Live:** [startup-scout-agent.vercel.app](https://startup-scout-agent.vercel.app)

---

## How it Works

```text
┌──────────────────────────┐        ┌──────────────────────────┐
│ Trigger.dev              │        │ sync-scheduled           │
│ (scheduling only)        │───────►│ (cron every 30 min)      │
│                          │        ├──────────────────────────┤
│ 1 fixed cron + one-off   │───────►│ run-scheduled-check      │
│ delayed triggers (real   │        │ (delayed, one-off)       │
│ point-in-time, not a     │        └──────────┬───────────────┘
│ poll)                    │
└──────────────────────────┘
                                            │ HTTP (shared secret)
                                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Modal — all agentic work                                            │
│ agent/ (Python): assistant_agent (SMS + dashboard chat + scheduled runs)  │
│ · feedback_agent                                                          │
│ Supermemory (brain) · Supabase (mirror)                             │
│ agent/trigger_client.py schedules/cancels one-off checks back onto  │
│ Trigger.dev's run-scheduled-check task (REST, with a delay)         │
└───────┬─────────────────────────────────────────────────────────────┘
        │
        ├── SendBlue (inbound/outbound iMessage)
        ├── Exa (startup discovery, deep research)
        ├── Linkup (news, fund blogs, press checks)
        └── Gemma 4 on Cerebras (daily portfolio re-check conviction filter)
                                            ┌──────────────────────┐
                                            │ Next.js (Vercel)     │
                                            │ dashboard + chat     │
                                            └──────────────────────┘
```

1. **Load memory**: every agent loads the live investment thesis and learned seek/avoid patterns directly
   from Supermemory before it does anything.
2. **iMessage loop**: text the agent directly — approve/pass startups, run an on-demand sweep, update the
   thesis, ask it to research something, ask what's currently scheduled, ask it to check back on something
   later (defaults to within 3 days unless you give it a specific longer timeframe), or cancel a scheduled
   check-in.
3. **Web chat**: a separate dashboard-side chat surface (`api/chat.py` on Vercel, `run_web_chat_stream`) with
   the same research/dealflow tools as the SMS agent. No shared memory with the iMessage thread — the client
   owns the full conversation history. Streams tokens and tool-call events over SSE; the dashboard shows a
   live "tool trace" dropdown per turn.
4. **Dashboard**: approve/pass/enrich startups, all live via Supabase realtime.

## Scheduling (Trigger.dev)

Modal has no native delayed-execution primitive (`modal.Cron` schedules are fixed at deploy time;
`.spawn()`/`modal.Queue` are immediate-dispatch only), so **Trigger.dev owns all scheduling** — both fixed
crons and one-off future work — while Modal keeps 100% of the agentic work. Every Trigger.dev task
(`src/trigger/*.ts`) is a thin `fetch()` forwarding call into a hardened Modal HTTP endpoint at the right
moment; nothing Python runs inside Trigger.dev.

- **Fixed crons**: `sync-scheduled` (*/30 min) — forwards to its Modal endpoint.
- **One-off delayed triggers**: the agent's own future work — a boss-requested follow-up or a
  self-scheduled check — is scheduled by calling Trigger.dev's REST trigger endpoint directly from
  Python (`agent/trigger_client.py`, no JS SDK involved) with a `delay`, targeting the `run-scheduled-check`
  task. Every call is also logged to the `scheduled_tasks` table (`agent/scheduled_tasks_log.py`), and the
  returned Trigger.dev run id is stashed into that same logged row, so the agent can both answer "what do
  you have scheduled" and genuinely cancel one later (`delete_scheduled_task` tool → `trigger_client.
  cancel_check`, `POST /api/v2/runs/{runId}/cancel`) rather than just deleting the log entry. Trigger.dev
  still owns actual timing. When a trigger fires at the exact right time (not a poll window), it forwards to
  Modal's `run_scheduled_check` endpoint, which dispatches by `kind`: `agent_followup` or `text_followup`
  (fired by the agent's `schedule_agent_run` tool — defaults to firing within 3 days unless the boss gave an
  explicit longer timeframe, replayed through the normal pipeline when due).
- **Hardening**: every Modal endpoint Trigger.dev calls checks a shared secret (`SCHEDULER_SHARED_SECRET`)
  sent in the request body — these are the only Modal endpoints reachable without prior application logic
  (dashboard endpoints have their own separate on-demand triggers, unrelated to scheduling).

---

## Agents (`agent/agent.py`)

`assistant_agent`, `feedback_agent` share the same Anthropic Claude Sonnet model and tool
registry (`register_tools` in `agent/agent.py`), just with different instructions and which tools are
enabled.

| Agent | Trigger | Purpose |
|---|---|---|
| `assistant_agent` | Inbound SMS (SendBlue webhook), dashboard chat POST, scheduled self-runs | Handles the boss's texts and dashboard chat: research, sweeps, approve/pass/delete, update thesis, schedule follow-ups. Unified across all surfaces — same tools, only reply style differs. |
| `feedback_agent` | Dashboard approve/pass reason submission | Distills a one-line dashboard reason into a reusable learning pattern. |

**Cross-agent context**: reflections (`write_reflection`) are namespaced by source (`text`, `web_chat`,
`feedback`) in Supermemory so concurrent writers never clobber each other. Scheduled-check alerts (a
portfolio update, in the future) get appended to the SMS agent's own conversation history via
`append_alert_to_history`, so a follow-up text has that context without re-fetching it.

**Memory model (Supermemory containers)**: `vc:thesis`, `vc:preferences` (seek/avoid patterns),
`vc:startups`, `vc:reflections` (namespaced by source). `vc:thesis` and `vc:preferences` are read on every
agent turn but cached for 5 minutes (`memory_store.py`, same pattern as the startup list) since they only
change on an explicit boss-initiated write. Scheduled tasks are **not** stored in Supermemory — they live in
Supabase (see below), intentionally kept out of every agent's standing context.

`load_thesis`/`load_preferences` sit behind two cache layers, not one: a process-local in-memory cache
(`memory_store.py`'s `_local_cache`, same 5-minute TTL) in front of the existing Supabase-backed `cache`
table. Both are read on every single agent turn regardless of surface, so this was a guaranteed 2 Supabase
round-trips per turn for a value that only changes on a deliberate write — the in-memory layer lets a warm
Modal container (`min_containers=1`) serve most of those from memory instead. Scoped to just these two
keys, not the generic cache module: conversation history deliberately stays Supabase-only, since two
concurrent containers racing on the same phone number's history need one source of truth.

---

## Supabase Schema

Supabase is a **read-only mirror** of Supermemory for the dashboard (kept in sync by `agent/sync.py`, run
both on a 30-min cron and on-demand after every scout/feedback event, batched via `.upsert()`/`.insert()`
rather than per-row calls) plus the `scheduled_tasks` and `cache` tables, which are written directly (no
Supermemory involved).

- `startups`: name, slug, one-liner, assessment, status (`new`/`approved`/`passed`), signal URLs, and
  enrichment fields (company description, founders, stage, raised, location, team size) populated by the
  on-demand enrichment job, plus outreach tracking: `linkedin_status`/`email_status`
  (not_contacted/contacted/replied) and `followup_count`/`last_followup_at`. Follow-ups are a counter
  rather than a status — the count already encodes whether we've chased anyone, and `last_followup_at`
  is what separates "chased twice this week" from "chased twice back in March"
  (`scripts/migrate-followups.sql`).
- `thesis`: the active investment thesis markdown content.
- `signals`: legacy table from the now-removed agent-directed crawling subsystem. Nothing writes to it
  anymore; left as-is rather than migrated away (see `scripts/migrate-signal-recheck-tracking.sql` for its
  original schema history).
- `scheduled_tasks`: was the old Supabase-polling self-scheduling table (see
  `scripts/migrate-scheduled-tasks.sql`), repurposed as a pure visibility + cancellation log now that
  Trigger.dev owns actual timing — `agent/trigger_client.py` logs a row on every schedule (stashing the
  Trigger.dev run id into the row's `payload` once known), `agent/scheduled_tasks_log.py` marks it done when
  it fires or deletes it when canceled, and `text_agent`'s `list_scheduled_tasks`/`delete_scheduled_task`
  tools read/cancel pending rows.
- `cache`: a general-purpose cache (Exa results, LLM outputs, SMS conversation history, thesis/preferences)
  — see `agent/cache.py`.

Full SQL schema (tables, indexes, RLS policies, realtime publication) is in `scripts/seed-supabase.py`. See
`scripts/migrations.sql`, `scripts/migrate-created-at.sql`, `scripts/migrate-signals-company-name.sql`, and
`scripts/migrate-signal-recheck-tracking.sql`, `scripts/migrate-followups.sql`, and
`scripts/migrate-stale-scheduled-tasks.sql` for incremental migrations applied since.

`scheduled_tasks.status` is **not** authoritative — Trigger.dev owns timing and `mark_done` is
best-effort, so a row can stay `pending` forever if a run never fired or its bookkeeping failed. Anything
more than an hour past `due_at` is treated as past by the dashboard (`src/lib/scheduledRuns.ts`) and by
the agent's `list_scheduled_tasks` tool, and `agent/sync.py` sweeps such rows to `done` on its cron.

---

## Dashboard (`src/`)

Next.js 16 + React 19 + Supabase, gated behind a single shared password (`DASHBOARD_PASSWORD`) that
issues an HMAC-signed session cookie (`src/lib/auth.ts`), verified on every request — pages and API
routes alike — by `src/proxy.ts`, and independently by `api/chat.py`, which is a Vercel Python
function the proxy never sees.

- **Tabs**: All / New / Approved / Passed, with live counts.
- **Realtime**: Supabase Postgres changes subscription for instant updates, falling back to polling if the
  public anon key isn't configured (`useLiveStartups`). The poll runs at 30s and only while the tab is
  visible — a backgrounded tab polling the whole table was the bulk of this project's Supabase egress.
- **List vs. detail payloads**: the list selects `STARTUP_LIST_COLUMNS` (`src/lib/supabase.ts`), never `*`.
  `founders` (tens of KB of JSONB per enriched row), `company_description` and `signal_urls` are not
  rendered in the list, and the only thing it needed from them — the enriched badge — is the denormalized
  `enriched` boolean (`scripts/migrate-egress-list-columns.sql`). Full rows are fetched one slug at a time
  when a startup is actually opened (`useLiveStartups`' `hydrate()` → `/api/startup/[slug]`).
- **Command palette** (⌘K / Ctrl+K): fuzzy-search and jump to any startup.
- **Startup detail page**: full assessment, enrichment data, and an "Enrich" button that kicks off an
  async Modal job (founder/social research via Exa) without blocking the dashboard.
- **Chat**: a web chat tab talking to `api/chat.py` directly on Vercel (streamed, no Modal hop) — same
  tool-registry agent as SMS, separate conversation with no shared memory. Shows a live tool-call trace
  dropdown per turn.
- **Feedback**: approving/passing a startup from the dashboard can include a reason, which gets distilled
  into a learning pattern by `feedback_agent` and mirrored into Supermemory immediately (not just on the
  next periodic sync) so a quick dashboard click never gets silently reverted.

---

## Orchestration (Modal + Trigger.dev)

Most agentic work lives in `modal_app.py`. Warm containers (`min_containers=1`) are kept on
interactive/scheduled endpoints to cut cold-start latency; timeouts are generous since agent turns involve
real web research. Functions marked "Trigger.dev" below have no `schedule=` of their own — Trigger.dev
calls them over HTTP at the right time (see [Scheduling](#scheduling-triggerdev)); all of them check
`SCHEDULER_SHARED_SECRET`.

Web chat is the one exception — it lives in `api/chat.py`, a Python function deployed alongside the
Next.js app on Vercel (see `vercel.json`, `api/requirements.txt`), not in `modal_app.py`. It imports
`agent/agent.py` directly (same `web_chat_agent` singleton and tool registry as the table below), streams
its reply as SSE, and needs `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `LINKUP_API_KEY`, `SUPERMEMORY_API_KEY`,
`SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` set as Vercel project env vars.

| Function | Trigger | Timeout | Description |
|---|---|---|---|
| `run_scheduled_check` | Trigger.dev one-off delayed trigger | 10 min | Dispatches a due self-scheduled check by `kind` (`agent_followup`/`text_followup`) |
| `sync_scheduled` / `sync_on_demand` | Trigger.dev cron (30 min) / on-demand | 5 min | Mirrors Supermemory → Supabase |
| `enrich_startup` | Dashboard POST | 1 min | Kicks off `enrich_startup_job` in the background |
| `submit_feedback` | Dashboard POST | 5 min | Runs `feedback_agent` on an approve/pass reason |
| `sendblue_webhook` | SMS webhook | 20 min | Validates the sender, spawns `chat_reply_background` |
| `chat_reply_background` | Webhook spawn | 20 min | Runs `text_agent`, sends the reply/tapback, syncs |

Trigger.dev's own tasks (`src/trigger/*.ts`) are thin forwarders — see the table in
[Scheduling](#scheduling-triggerdev) above for what each one calls.

---

## Setup & Deployment

### 1. Database Setup
1. Spin up a Supabase project.
2. Run the SQL schema at the top of [`scripts/seed-supabase.py`](scripts/seed-supabase.py) in the SQL Editor.
3. Apply `scripts/migrations.sql`, `scripts/migrate-created-at.sql`, `scripts/migrate-signals-company-name.sql`,
   and `scripts/migrate-signal-recheck-tracking.sql` if starting from an older schema.
   Then apply `scripts/migrate-followups.sql` (follow-up tracking columns) and
   `scripts/migrate-stale-scheduled-tasks.sql` (one-time cleanup of scheduled runs stuck at
   `pending`).
4. **Apply `scripts/migrate-rls-lockdown.sql`** on any existing project. Earlier versions of the
   schema granted the public `anon` key full read/write on `cache` (which stores conversation
   history, thesis and preferences) and `scheduled_tasks`, with no RLS — this revokes that and
   enables RLS. Do this before anything else if you're already deployed.

### 2. Environment Variables

See [`.env.example`](.env.example) for the full annotated list. Three places need env vars: Modal, Trigger.dev,
and Vercel.

#### Modal (Backend Secrets)
Create/update the `vc-scout-secrets` Modal secret — note `TRIGGER_SECRET_KEY` (Modal calls out to
Trigger.dev's REST API to schedule one-off checks) and `SCHEDULER_SHARED_SECRET` (Modal checks this on every
endpoint Trigger.dev calls) are new:
```bash
modal secret create vc-scout-secrets \
  ANTHROPIC_API_KEY=your_key \
  EXA_API_KEY=your_key \
  LINKUP_API_KEY=your_key \
  SUPERMEMORY_API_KEY=your_key \
  SUPABASE_URL=your_supabase_url \
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  SENDBLUE_API_KEY=your_sendblue_key \
  SENDBLUE_API_SECRET=your_sendblue_secret \
  ALERT_PHONE_NUMBER=your_number_E164 \
  SENDBLUE_FROM_NUMBER=your_sendblue_number \
  CEREBRAS_API_KEY=your_cerebras_key \
  TRIGGER_SECRET_KEY=your_trigger_dev_secret_key \
  SCHEDULER_SHARED_SECRET=a_random_string_you_generate \
  DASHBOARD_SHARED_SECRET=another_random_string_you_generate \
  SENDBLUE_WEBHOOK_SECRET=a_third_random_string_you_generate
```
`DASHBOARD_SHARED_SECRET` guards the Modal endpoints the dashboard calls (`enrich_startup`,
`submit_feedback`, `cancel_scheduled_task`, `reschedule_scheduled_task`) — they're public URLs
otherwise. Set the same value on Vercel. If you leave it unset, Modal accepts
`SCHEDULER_SHARED_SECRET` there instead, so a single-secret setup still works.
`SENDBLUE_WEBHOOK_SECRET` is optional: append it to the webhook URL you register with SendBlue
(`https://...-sendblue-webhook.modal.run?secret=...`). The inbound sender number is only a body
field, so without it anyone who learns the URL can forge a message from an allowed number.
`modal secret create` replaces the whole secret rather than merging — always pass every key, not just new
ones, when updating.

Deploy with:
```bash
modal deploy modal_app.py
```

#### Trigger.dev
Fill in `trigger.config.ts`'s `project` field with your Trigger.dev project ref (Trigger.dev dashboard →
Project settings). In the Trigger.dev dashboard, add these environment variables per environment (dev + prod):
`MODAL_SYNC_URL`, `MODAL_RUN_SCHEDULED_CHECK_URL` (the deployed Modal endpoint
URLs, printed by `modal deploy`), and `SCHEDULER_SHARED_SECRET` (same value as the Modal secret above).

Deploy with:
```bash
npm run trigger:deploy
```

#### Vercel / Next.js (`.env.local`)
See `.env.example` for the full list (Supabase URL/keys, `MODAL_ENRICH_URL`, `MODAL_FEEDBACK_URL`,
`MODAL_WEBHOOK_URL`, `SUPERMEMORY_API_KEY`). Auth-related vars, all required:
- `DASHBOARD_PASSWORD` — the login password (previously hardcoded in the source; pick a new one).
- `DASHBOARD_SESSION_SECRET` — signing key for the session cookie (`openssl rand -hex 32`). Used by
  both the Next app and `api/chat.py`, which verifies the same token in Python.
- `DASHBOARD_SHARED_SECRET` — same value as the Modal secret above; sent to Modal's dashboard
  endpoints.

---

## Local Development

1. Install dependencies:
   ```bash
   npm install
   pip install -r requirements.txt
   ```
2. Seed Supermemory with your initial thesis/patterns (first-time setup only):
   ```bash
   python3 scripts/seed-supabase.py
   ```
3. Run the dashboard:
   ```bash
   npm run dev
   ```
4. Run Trigger.dev tasks locally against your dev environment (requires `TRIGGER_SECRET_KEY` set):
   ```bash
   npm run trigger:dev
   ```
   Test-run a task from the Trigger.dev dashboard to confirm it reaches your deployed Modal endpoints.

---

## Repository Layout

```
agent/                Python agents and tools (deployed to Modal)
  agent.py             Agent definitions (assistant/feedback), tool registry, orchestration
  memory_store.py      Supermemory read/write layer (thesis, preferences, startups, reflections)
  trigger_client.py    REST client for scheduling/canceling one-off delayed triggers on Trigger.dev
  scheduled_tasks_log.py  Visibility + cancellation log for trigger_client's scheduled tasks
  llm.py               Model/settings config, retry logic
  cache.py             Supabase-backed cache (Exa results, LLM outputs, SMS history, thesis/preferences)
  sync.py              Supermemory -> Supabase mirror (batched)
  enrich.py            Founder/company enrichment structuring
  tools/               Exa and Linkup client wrappers
modal_app.py           All Modal function definitions and web endpoints (agentic work)
trigger.config.ts      Trigger.dev project config
src/trigger/           Trigger.dev tasks — thin scheduling forwarders into Modal
src/app/               Next.js dashboard (App Router), API routes, components, hooks
src/lib/               Supabase clients, Supermemory REST helper, shared types
scripts/               Supabase schema + migrations, Supermemory seeding
```
