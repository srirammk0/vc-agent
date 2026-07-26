# VC Research Agent

Automated pre-seed/seed AI startup scout. A Pydantic AI agent (Anthropic Claude) researches and saves
early-stage AI companies — persisted to **Supermemory** (thesis + learned preferences) and **Supabase**
(dealflow, live) for a Next.js dashboard. **Trigger.dev** is the only backend runtime: it owns both
scheduling (fixed-point-in-time delayed triggers, not polling) and running the agent's Python itself, via
its official Python build extension — there is no separate compute platform. A web chat surface runs
directly on Vercel instead (`api/chat.py`, streaming via `run_web_chat_stream`) — real token streaming plus
a live tool-call trace in the UI, no extra hop.

**Live:** [startup-scout-agent.vercel.app](https://startup-scout-agent.vercel.app)

---

## How it Works

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Trigger.dev — the only backend runtime                                 │
│                                                                          │
│ src/trigger/run-scheduled-check.ts — one task, mode-dispatched:        │
│   python.runScript("agent/main.py", [JSON.stringify(payload)])         │
│   (pythonExtension in trigger.config.ts installs Python +               │
│   requirements.txt into the build; no other compute platform involved) │
│                                                                          │
│ Triggered two ways:                                                     │
│   • Immediately — dashboard routes call .trigger({mode: "enrich" |     │
│     "feedback", ...}) via the JS SDK (fire-and-forget)                 │
│   • On a delay — agent/trigger_client.py calls Trigger.dev's REST      │
│     trigger endpoint with {mode: "scheduled_check", kind, ...} and a   │
│     `delay`, for schedule_agent_run follow-ups                         │
│                                                                          │
│ agent/ (Python): assistant_agent — one Agent, mode="assistant" or      │
│ "feedback" (AgentDeps.mode) picks instructions + which tools are        │
│ visible for that run                                                    │
│   Supermemory (thesis + preferences)                                    │
│   Supabase (dealflow, scheduled-task log, cache — no mirroring)         │
│   Exa (startup discovery, deep research) · Linkup (news, press checks)  │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Next.js (Vercel)              │
                  │ dashboard + api/chat.py        │
                  │ (web chat — direct, no         │
                  │  Trigger.dev hop)              │
                  └──────────────────────────────┘
```

1. **Web chat**: the dashboard's chat tab (`api/chat.py` on Vercel, `run_web_chat_stream`) — full
   research/dealflow tool access. Streams tokens and tool-call events over SSE; the UI shows a live "tool
   trace" dropdown per turn.
2. **Dashboard**: approve/pass/enrich startups, all live via Supabase realtime.
3. **Scheduled runs**: ask the agent (in chat) to check back on something later — it schedules a real future
   run of itself via Trigger.dev's delayed-trigger API, defaulting to within 3 days unless you give it a
   specific longer timeframe. The outcome lands on the dashboard's Scheduled Runs page.
4. **Feedback**: approving/passing a startup from the dashboard can include a reason, distilled into a
   learned preference by the same agent in a narrow mode (`AgentDeps.mode="feedback"`).

## Scheduling (Trigger.dev)

Neither Vercel nor Trigger.dev's own compute has a native "run this at an arbitrary future timestamp"
primitive outside of Trigger.dev's own delayed-trigger REST API — so Trigger.dev owns scheduling
end-to-end, real point-in-time, not a poll.

- **One-off delayed triggers**: the agent's own future work — a boss-requested follow-up or a
  self-scheduled check — is scheduled by calling Trigger.dev's REST trigger endpoint directly from Python
  (`agent/trigger_client.py`, no JS SDK involved — this runs inside the Python subprocess Trigger.dev
  itself shells out to) with a `delay`, targeting the `run-scheduled-check` task. Every call is also logged
  to the `scheduled_tasks` table (`agent/scheduled_tasks_log.py`), and the returned Trigger.dev run id is
  stashed into that same logged row, so the agent can both answer "what do you have scheduled" and
  genuinely cancel one later (`delete_scheduled_task` chat tool → `trigger_client.cancel_check`,
  `POST /api/v2/runs/{runId}/cancel`) rather than just deleting the log entry.
- **What fires**: when a trigger fires at the exact right time, `run-scheduled-check` runs
  `agent/main.py` with the fired payload — `agent.py`'s `run_agent()` dispatches on `payload["mode"]`.
  For a delayed trigger that's `mode="scheduled_check"`, which sub-dispatches by `kind`
  (`agent_followup`, or the legacy `text_followup`) and runs the agent with the saved instructions.
- **Dashboard-triggered work** (enrichment, feedback) uses the exact same task, just triggered immediately
  via the SDK (`runScheduledCheck.trigger({mode: "enrich", ...})`) from the relevant Next.js route instead
  of via a delayed REST call — see [Orchestration](#orchestration-triggerdev) below.
- **Cancel/reschedule from the dashboard** are the one exception: implemented directly in TypeScript
  (`src/lib/scheduledTasks.ts`) rather than routed through a Trigger.dev task, because the dashboard needs
  a real synchronous answer for its button click and Trigger.dev tasks are inherently async. See that
  file's docstring for the full reasoning — it's a deliberate, documented duplication of
  `agent/trigger_client.py`'s cancel/reschedule REST logic, not an oversight.

---

## Agent (`agent/agent.py`)

One `Agent` object (`assistant_agent`, Claude Sonnet) serves every job. `AgentDeps.mode` picks behavior
per call rather than needing a separate `Agent` per job:

| mode | Used by | Tools visible | Model |
|---|---|---|---|
| `"assistant"` (default) | Dashboard chat, scheduled runs | All of them | Sonnet (`llm.FINALIZE_SETTINGS`) |
| `"feedback"` | Dashboard approve/pass reason submission | `write_preferences` only | Haiku, per-call override (`llm.fast_model`, `llm.FINALIZE_FEEDBACK_SETTINGS`) |

Tool visibility is enforced by a `prepare` hook (`assistant_only` in `agent.py`) that returns `None` —
excluding the tool from that run's schema entirely, not just discouraging it in the prompt — for every
tool except `write_preferences` when `mode="feedback"`. `background` (a separate `AgentDeps` field) picks
the closing reply style for scheduled runs (plain-text outcome report) independent of `mode`.

**Memory model (Supermemory containers)**: `vc:thesis`, `vc:preferences` (seek/avoid patterns) — read on
every agent turn but cached for 5 minutes (`memory_store.py`) since they only change on an explicit
boss-initiated write. Dealflow and scheduled tasks are **not** stored in Supermemory at all — they live
directly in Supabase (see below), intentionally kept out of every agent's standing context.

`load_thesis`/`load_preferences` sit behind two cache layers: a process-local in-memory cache
(`memory_store.py`'s `_local_cache`, same 5-minute TTL) in front of the Supabase-backed `cache` table. Both
are read on every single agent turn, so this cuts a guaranteed 2 Supabase round-trips per turn down to
zero whenever the Python process handling the call is reused across invocations (true for `api/chat.py`'s
long-lived Vercel function; true for a warm Trigger.dev worker, unverified how often that holds) — never
worse than the old always-hit-Supabase behavior on a cold one.

---

## Supabase Schema

Supabase holds dealflow, the scheduled-task log, and a general-purpose cache — all written to directly,
with no mirroring step from Supermemory.

- `startups`: name, slug, one-liner, assessment, status (`new`/`approved`/`passed`), signal URLs, and
  enrichment fields (company description, founders, stage, raised, location, team size) populated by the
  on-demand enrichment job (`agent/enrich_job.py`), plus outreach tracking: `linkedin_status`/`email_status`
  (not_contacted/contacted/replied) and `followup_count`/`last_followup_at`. Follow-ups are a counter
  rather than a status — the count already encodes whether we've chased anyone, and `last_followup_at`
  is what separates "chased twice this week" from "chased twice back in March"
  (`scripts/migrate-followups.sql`).
- `scheduled_tasks`: was the old Supabase-polling self-scheduling table (see
  `scripts/migrate-scheduled-tasks.sql`), repurposed as a pure visibility + cancellation log now that
  Trigger.dev owns actual timing — `agent/trigger_client.py` logs a row on every schedule (stashing the
  Trigger.dev run id into the row's `payload` once known), `agent/scheduled_tasks_log.py` marks it done
  when it fires. Rows are read/cancelled two ways: the `list_scheduled_tasks`/`delete_scheduled_task` chat
  tools (Python, `agent/trigger_client.py`), and the dashboard's Cancel/Reschedule buttons (TypeScript,
  `src/lib/scheduledTasks.ts` — a deliberate separate port, see Scheduling above).
- `cache`: a general-purpose cache (Exa/Linkup results, LLM outputs, thesis/preferences) — see
  `agent/cache.py`.

`signals` no longer exists — it was a legacy table from an already-removed agent-directed crawling
subsystem, confirmed empty with no current writer, dropped by `scripts/migrate-remove-dead-sync.sql`
alongside orphaned `cache` rows the same dead subsystem left behind. `scripts/migrate-signals-company-name.sql`
and `scripts/migrate-signal-recheck-tracking.sql` remain in `scripts/` as historical record of that table's
schema, not as migrations you need to run.

Full SQL schema (tables, indexes, RLS policies, realtime publication) is in `scripts/seed-supabase.py`. See
`scripts/migrations.sql`, `scripts/migrate-created-at.sql`, `scripts/migrate-followups.sql`,
`scripts/migrate-stale-scheduled-tasks.sql`, and `scripts/migrate-remove-dead-sync.sql` for incremental
migrations applied since.

`scheduled_tasks.status` is **not** authoritative — Trigger.dev owns timing and `mark_done` is
best-effort, so a row can stay `pending` forever if a run never fired or its bookkeeping failed. Anything
more than an hour past `due_at` is treated as past by the dashboard (`src/lib/scheduledRuns.ts`) and by
the agent's `list_scheduled_tasks` tool (`scheduled_tasks_log.list_pending`'s own cutoff) regardless of
what the stored `status` column says.

---

## Dashboard (`src/`)

Next.js 16 + React 19 + Supabase, gated behind a single shared password (`DASHBOARD_PASSWORD`) that
issues an HMAC-signed session cookie (`src/lib/auth.ts`), verified on every request — pages and API
routes alike — by `src/proxy.ts`, and independently by `api/chat.py`, which is a Vercel Python
function the proxy never sees.

- **Tabs**: All / New / Approved / Passed, with live counts.
- **Realtime**: Supabase Postgres changes subscription for instant updates, falling back to polling if the
  public anon key isn't configured (`useLiveStartups`). The poll runs at 30s and only while the tab is
  visible.
- **List vs. detail payloads**: the list selects `STARTUP_LIST_COLUMNS` (`src/lib/supabase.ts`), never `*`.
  `founders` (tens of KB of JSONB per enriched row), `company_description` and `signal_urls` are not
  rendered in the list, and the only thing it needed from them — the enriched badge — is the denormalized
  `enriched` boolean (`scripts/migrate-egress-list-columns.sql`). Full rows are fetched one slug at a time
  when a startup is actually opened (`useLiveStartups`' `hydrate()` → `/api/startup/[slug]`).
- **Command palette** (⌘K / Ctrl+K): fuzzy-search and jump to any startup.
- **Startup detail page**: full assessment, enrichment data, and an "Enrich" button that fires the
  Trigger.dev job (founder/social research via Exa) without blocking the dashboard.
- **Chat**: a web chat tab talking to `api/chat.py` directly on Vercel (streamed). Shows a live tool-call
  trace dropdown per turn.
- **Feedback**: approving/passing a startup from the dashboard can include a reason, which gets distilled
  into a learning pattern by the agent's feedback mode and written into Supermemory immediately (not just
  on a periodic sync — there isn't one) so a quick dashboard click never gets silently reverted.

---

## Orchestration (Trigger.dev)

The only backend Python entrypoint is `agent/main.py`, reached two ways:

- **Directly**, from `api/chat.py` on Vercel — web chat imports `agent/agent.py`'s `run_web_chat_stream`
  in-process (same Python interpreter, no subprocess), needs `ANTHROPIC_API_KEY`, `EXA_API_KEY`,
  `LINKUP_API_KEY`, `SUPERMEMORY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DASHBOARD_SESSION_SECRET` set as Vercel project env vars.
- **Via `python.runScript`**, from Trigger.dev's one task (`src/trigger/run-scheduled-check.ts`) — every
  other job (enrichment, feedback, scheduled-check dispatch) shells out to `agent/main.py` with a JSON
  payload on argv, gets JSON back on stdout, same shape regardless of which of these triggered it:

| Caller | How | Payload |
|---|---|---|
| `/api/enrich` (dashboard "Enrich" button) | `.trigger()`, fire-and-forget | `{mode: "enrich", slug, name}` |
| `/api/feedback` (dashboard approve/pass reason) | `.trigger()`, fire-and-forget | `{mode: "feedback", slug, name, status, message}` |
| `agent/trigger_client.py` (`schedule_agent_run` tool) | REST trigger endpoint, delayed | `{mode: "scheduled_check", kind: "agent_followup", instructions, ...}` |

`agent.py`'s `run_agent()` dispatches on `payload["mode"]`:
- `"feedback"` → `run_feedback` (Haiku, narrow tool set — see Agent above)
- `"scheduled_run"` → `run_scheduled_agent_run` (runs saved instructions autonomously, reply lands on the
  dashboard's Scheduled Runs page)
- `"scheduled_check"` → `run_scheduled_check` (sub-dispatches by `kind`, then calls `run_scheduled_agent_run`;
  marks the `scheduled_tasks` log row done with the outcome)
- `"enrich"` → `agent/enrich_job.py`'s `run_enrichment` (Exa research + structuring, writes directly to
  Supabase, no LLM agent loop beyond the narrow structuring call in `enrich.py`)

Cancel/reschedule from the dashboard bypass this entirely — see
[Scheduling](#scheduling-triggerdev) for why.

---

## Setup & Deployment

### 1. Database Setup
1. Spin up a Supabase project.
2. Run the SQL schema at the top of [`scripts/seed-supabase.py`](scripts/seed-supabase.py) in the SQL Editor.
3. Apply `scripts/migrations.sql` and `scripts/migrate-created-at.sql` if starting from an older schema.
   Then apply `scripts/migrate-followups.sql` (follow-up tracking columns) and
   `scripts/migrate-stale-scheduled-tasks.sql` (one-time cleanup of scheduled runs stuck at
   `pending`).
4. **Apply `scripts/migrate-rls-lockdown.sql`** on any existing project. Earlier versions of the
   schema granted the public `anon` key full read/write on `cache` (which stores thesis and
   preferences) and `scheduled_tasks`, with no RLS — this revokes that and enables RLS. Do this before
   anything else if you're already deployed.
5. **Apply `scripts/migrate-remove-dead-sync.sql`** on any existing project. Drops the `thesis` table
   (a Supabase-side mirror of Supermemory's thesis that nothing ever read) and the now-empty `signals`
   table, plus orphaned `cache` rows both left behind.
6. **Apply `scripts/migrate-egress-list-columns.sql`** — adds the `enriched` column the dashboard list
   query expects.

### 2. Environment Variables

See [`.env.example`](.env.example) for the full annotated list. Two places need env vars now: Trigger.dev
and Vercel. (Modal is gone — nothing to configure there anymore.)

#### Trigger.dev
Fill in `trigger.config.ts`'s `project` field with your Trigger.dev project ref (Trigger.dev dashboard →
Project settings). In the Trigger.dev dashboard, add these environment variables per environment (dev +
prod) — this is where `agent/main.py` actually runs now, so it needs everything the agent needs:
```
ANTHROPIC_API_KEY
EXA_API_KEY
LINKUP_API_KEY
SUPERMEMORY_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
TRIGGER_SECRET_KEY       # trigger_client.py calls Trigger.dev's own REST API to
                         # schedule/cancel delayed runs — needs a bearer token
                         # regardless of caller
LOGFIRE_TOKEN            # optional, tracing skipped if unset
```

Deploy with:
```bash
npm run trigger:deploy
```

#### Vercel / Next.js (`.env.local`)
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY          # dashboard reads/writes, and api/chat.py
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY   # browser realtime (optional — falls back to polling)
ANTHROPIC_API_KEY, EXA_API_KEY, LINKUP_API_KEY, SUPERMEMORY_API_KEY   # api/chat.py (web chat) needs these too
TRIGGER_SECRET_KEY       # for .trigger() calls from /api/enrich, /api/feedback, and
                         # src/lib/scheduledTasks.ts's direct REST calls
DASHBOARD_PASSWORD       # the login password
DASHBOARD_SESSION_SECRET # signing key for the session cookie (`openssl rand -hex 32`) —
                         # used by both the Next app and api/chat.py, which verifies
                         # the same token in Python
```
See `.env.example` for the full annotated list.

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
   Test-run the `run-scheduled-check` task from the Trigger.dev dashboard with a `{mode: "enrich", ...}`
   or `{mode: "feedback", ...}` payload to confirm the Python extension builds and runs correctly before
   relying on it in production.

---

## Repository Layout

```
agent/                Python agent (run by Trigger.dev's python.runScript, and imported
                       directly by api/chat.py for web chat)
  main.py             Entrypoint — reads a JSON payload from argv/stdin, calls run_agent(), prints JSON
  agent.py             Agent definition (assistant_agent), tool registry, mode dispatch, orchestration
  memory_store.py      Supermemory read/write layer (thesis, preferences) + in-memory cache layer
  startups_store.py    Supabase dealflow read/write layer (startups live here directly, no mirror)
  enrich.py            Founder/company enrichment structuring (the narrow LLM call, not the job itself)
  enrich_job.py         The enrichment job — Exa research + structuring + Supabase write, mode="enrich"
  trigger_client.py    REST client for scheduling/canceling one-off delayed triggers on Trigger.dev
  scheduled_tasks_log.py  Visibility log for trigger_client's scheduled tasks
  llm.py               Model/settings config, retry logic
  cache.py             Supabase-backed cache (Exa/Linkup results, LLM outputs, thesis/preferences)
  tools/               Exa and Linkup client wrappers
trigger.config.ts      Trigger.dev project config — pythonExtension installs Python + requirements.txt
src/trigger/           Trigger.dev's one task (run-scheduled-check.ts) — shells out to agent/main.py
src/app/               Next.js dashboard (App Router), API routes, components, hooks
src/lib/               Supabase clients, shared types, scheduledTasks.ts (cancel/reschedule TS port)
scripts/               Supabase schema + migrations, Supermemory seeding
```
