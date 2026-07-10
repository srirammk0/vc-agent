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
│ Trigger.dev              │        │ daily-planner-scheduled  │
│ (scheduling only)        │───────►│ (cron 6:00am ET)         │
│                          │        ├──────────────────────────┤
│ 2 fixed crons + one-off  │───────►│ sync-scheduled           │
│ delayed triggers (real   │        │ (cron every 30 min)      │
│ point-in-time, not a     │        ├──────────────────────────┤
│ poll)                    │───────►│ run-scheduled-check      │
│                          │        │ (delayed, one-off)       │
└──────────────────────────┘        └──────────┬───────────────┘
                                            │ HTTP (shared secret)
                                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Modal — all agentic work                                            │
│ agent/ (Python): text_agent (SMS) · web_chat_agent (dashboard chat, │
│ no shared memory with SMS) · feedback_agent · daily_planner_agent   │
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
2. **Daily planning**: every morning at 6am ET, `daily_planner_agent` looks at approved startups nobody's
   checked on in a while and decides — with judgment, not a fixed replay — which ones deserve a fresh look
   today, scheduling each at a specific time. Each fired check runs one fresh Exa search + one Gemma
   conviction call scoped to that company; only re-surfaces (texts you) if conviction clears the bar.
3. **iMessage loop**: text the agent directly — approve/pass startups, run an on-demand sweep, update the
   thesis, ask it to research something, ask what's currently scheduled, ask it to check back on something
   later (defaults to within 3 days unless you give it a specific longer timeframe), or cancel a scheduled
   check-in.
4. **Web chat**: a separate dashboard-side chat surface (`api/chat.py` on Vercel, `run_web_chat_stream`) with
   the same research/dealflow tools as the SMS agent, minus follow-up scheduling and iMessage-specific tools.
   No shared memory with the iMessage thread — the client owns the full conversation history. Streams tokens
   and tool-call events over SSE; the dashboard shows a live "tool trace" dropdown per turn.
5. **Dashboard**: approve/pass/enrich startups, all live via Supabase realtime.

## Scheduling (Trigger.dev)

Modal has no native delayed-execution primitive (`modal.Cron` schedules are fixed at deploy time;
`.spawn()`/`modal.Queue` are immediate-dispatch only), so **Trigger.dev owns all scheduling** — both fixed
crons and one-off future work — while Modal keeps 100% of the agentic work. Every Trigger.dev task
(`src/trigger/*.ts`) is a thin `fetch()` forwarding call into a hardened Modal HTTP endpoint at the right
moment; nothing Python runs inside Trigger.dev.

- **Fixed crons**: `sync-scheduled` (*/30 min), `daily-planner-scheduled` (0 6 * * * America/New_York) —
  each just forwards to its Modal endpoint.
- **One-off delayed triggers**: the agent's own future work — a boss-requested follow-up text or a
  daily-planner portfolio check — is scheduled by calling Trigger.dev's REST trigger endpoint directly from
  Python (`agent/trigger_client.py`, no JS SDK involved) with a `delay`, targeting the `run-scheduled-check`
  task. Every call is also logged to the `scheduled_tasks` table (`agent/scheduled_tasks_log.py`), and the
  returned Trigger.dev run id is stashed into that same logged row, so the agent can both answer "what do
  you have scheduled" and genuinely cancel one later (`delete_scheduled_task` tool → `trigger_client.
  cancel_check`, `POST /api/v2/runs/{runId}/cancel`) rather than just deleting the log entry. Trigger.dev
  still owns actual timing. When a trigger fires at the exact right time (not a poll window), it forwards to
  Modal's `run_scheduled_check` endpoint, which dispatches by `kind`: `text_followup` (fired by `text_agent`'s
  `schedule_followup` tool — defaults to firing within 3 days unless the boss gave an explicit longer
  timeframe, replayed through the normal SMS pipeline when due, as if the boss had just texted it) and
  `daily_check` (fired by `daily_planner_agent`'s `schedule_check` tool).
- **Hardening**: every Modal endpoint Trigger.dev calls checks a shared secret (`SCHEDULER_SHARED_SECRET`)
  sent in the request body — these are the only Modal endpoints reachable without prior application logic
  (dashboard endpoints have their own separate on-demand triggers, unrelated to scheduling).

---

## Agents (`agent/agent.py`)

`text_agent`, `web_chat_agent`, and `feedback_agent` share the same Anthropic Claude Sonnet model and tool
registry (`register_tools` in `agent/agent.py`), just with different instructions and which tools are
enabled. `daily_planner_agent` is a separate, purpose-built agent (its own tool set, rebuilt fresh per run).

| Agent | Trigger | Purpose |
|---|---|---|
| `text_agent` | Inbound SMS (SendBlue webhook) | Handles the boss's texts: approve/pass, delete, research a company, update the thesis, run an on-demand sweep, or schedule/cancel a future check-in. Has a standing rule to save any genuine startup it surfaces during research — not just on explicit sweep requests. |
| `web_chat_agent` | Dashboard chat POST, streamed (`api/chat.py` on Vercel, `run_web_chat_stream`) | Same research/dealflow tools as `text_agent`, minus follow-up scheduling and iMessage-specific tools (both need a phone number). Module-level singleton like `text_agent`; history is reconstructed per-call from the client-supplied message array, no server-side persistence. Runs directly on Vercel, not Modal. |
| `daily_planner_agent` | Trigger.dev `daily-planner-scheduled` cron (6:00am ET) | Looks at approved startups nobody's checked on in a while and decides which deserve a fresh look today, scheduling each at a specific time. Built fresh per run (see `agent/daily_planner.py`). |
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

---

## Supabase Schema

Supabase is a **read-only mirror** of Supermemory for the dashboard (kept in sync by `agent/sync.py`, run
both on a 30-min cron and on-demand after every scout/feedback event, batched via `.upsert()`/`.insert()`
rather than per-row calls) plus the `scheduled_tasks` and `cache` tables, which are written directly (no
Supermemory involved).

- `startups`: name, slug, one-liner, assessment, status (`new`/`approved`/`passed`), signal URLs, and
  enrichment fields (company description, founders, stage, raised, location, team size) populated by the
  on-demand enrichment job.
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
`scripts/migrate-signal-recheck-tracking.sql` for incremental migrations applied since.

---

## Dashboard (`src/`)

Next.js 16 + React 19 + Supabase, gated behind a single shared-password cookie (`src/proxy.ts`,
`src/app/login/`).

- **Tabs**: All / New / Approved / Passed, with live counts.
- **Realtime**: Supabase Postgres changes subscription for instant updates, falling back to polling if the
  public anon key isn't configured (`useLiveStartups`).
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
| `daily_planner_scheduled` | Trigger.dev cron, daily 6:00am ET | 10 min | `daily_planner_agent` decides today's portfolio checks |
| `run_scheduled_check` | Trigger.dev one-off delayed trigger | 10 min | Dispatches a due self-scheduled check by `kind` (`text_followup`/`daily_check`) |
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
  SCHEDULER_SHARED_SECRET=a_random_string_you_generate
```
`modal secret create` replaces the whole secret rather than merging — always pass every key, not just new
ones, when updating.

Deploy with:
```bash
modal deploy modal_app.py
```

#### Trigger.dev
Fill in `trigger.config.ts`'s `project` field with your Trigger.dev project ref (Trigger.dev dashboard →
Project settings). In the Trigger.dev dashboard, add these environment variables per environment (dev + prod):
`MODAL_SYNC_URL`, `MODAL_DAILY_PLANNER_URL`, `MODAL_RUN_SCHEDULED_CHECK_URL` (the deployed Modal endpoint
URLs, printed by `modal deploy`), and `SCHEDULER_SHARED_SECRET` (same value as the Modal secret above).

Deploy with:
```bash
npm run trigger:deploy
```

#### Vercel / Next.js (`.env.local`)
See `.env.example` for the full list (Supabase URL/keys, `MODAL_ENRICH_URL`, `MODAL_FEEDBACK_URL`,
`MODAL_WEBHOOK_URL`, `SUPERMEMORY_API_KEY`).

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
  agent.py             Agent definitions (text/web_chat/feedback), tool registry, orchestration
  memory_store.py      Supermemory read/write layer (thesis, preferences, startups, reflections)
  daily_planner.py     Daily daily_planner_agent: schedules portfolio checks, runs them when due
  gemma_filter.py       Cerebras-hosted Gemma conviction filter (used by daily_planner's re-checks)
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
