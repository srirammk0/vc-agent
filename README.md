# VC Research Agent

Automated pre-seed/seed AI startup scout. A set of Pydantic AI agents (Anthropic Claude Sonnet) research and
save early-stage AI companies, run a continuous multi-source signal feed, and text you about all of it —
persisted to **Supermemory** (the agent's brain) and mirrored to **Supabase** for a live Next.js dashboard.
Orchestrated by **Modal** with warm containers and scheduled crons.

**Live:** [startup-scout-agent.vercel.app](https://startup-scout-agent.vercel.app)

---

## How it Works

```text
┌───────────────────────┐   cron: every 2h         ┌──────────────────┐
│  Modal                │◄────────────────────────│ signals_scheduled │
│                       │                          └──────────────────┘
│  agent/ (Python)      │   cron: daily 11:50pm ET ┌──────────────────┐
│  - text_agent (SMS)   │◄────────────────────────│ signals_review_  │
│  - feedback_agent     │                          │ scheduled        │
│  - signals_review_    │                          └──────────────────┘
│    agent               │   cron: every 20 min     ┌──────────────────┐
│                       │◄────────────────────────│ scheduled_tasks_ │
│  Supermemory (brain)  │                          │ poller           │
│  Supabase (mirror +   │                          └──────────────────┘
│  signals + scheduled_ │   cron: every 30 min     ┌──────────────────┐
│  tasks)               │◄────────────────────────│ sync_scheduled   │
└───────┬───────────────┘                          └──────────────────┘
        │
        ├── SendBlue (inbound/outbound iMessage)
        ├── Exa (startup discovery, deep research)
        ├── Linkup (news, fund blogs, press checks)
        └── Gemma 4 on Cerebras (strict signal-quality filter)
                                                    ┌──────────────────┐
                                                    │ Next.js (Vercel) │
                                                    │ dashboard        │
                                                    └──────────────────┘
```

1. **Load memory**: every agent loads the live investment thesis and learned seek/avoid patterns directly
   from Supermemory before it does anything.
2. **Signals feed**: `signals_scheduled` crawls LinkedIn/X every 2h for early-stage AI startup signals
   (including founders building in or just out of stealth), scores them with regex heuristics, and runs a
   final strict Gemma pass — capped at 50 approved signals per day (70% LinkedIn / 30% X by conviction).
3. **Daily signal review**: once a day, `signals_review_agent` reads every signal from that day at
   excerpt-level (no deep research), deletes bad/duplicate/noise, and schedules a re-check on the few
   genuinely promising ones — see [Self-scheduling](#self-scheduling-agentscheduler.py) below.
4. **iMessage loop**: text the agent directly — approve/pass startups, run an on-demand sweep, update the
   thesis, ask it to research something, or ask it to check back on something later. It saves what it finds.
5. **Dashboard**: approve/pass/enrich startups, browse and dismiss signals, all live via Supabase realtime.

## Self-scheduling (`agent/scheduler.py`)

Modal has no native delayed-execution primitive (`modal.Cron` schedules are fixed at deploy time;
`.spawn()`/`modal.Queue` are immediate-dispatch only), so the agent's own future work — a signal re-check,
a boss-requested follow-up text — is a row in the Supabase `scheduled_tasks` table, popped every 20 minutes
by `scheduled_tasks_poller`. Two kinds: `signal_recheck` (fired by `signals_review_agent`'s
`schedule_signal_check` tool, capped at 2 re-checks per signal and spaced ≥7 days apart) and
`text_followup` (fired by `text_agent`'s `schedule_followup` tool when the boss asks to be reminded about
something — replayed through the normal SMS pipeline when due, as if the boss had just texted it).

---

## Agents (`agent/agent.py`)

All three agents share the same Anthropic Claude Sonnet model and tool registry
(`register_tools` in `agent/agent.py`), just with different system prompts and which tools are enabled.

| Agent | Trigger | Purpose |
|---|---|---|
| `text_agent` | Inbound SMS (SendBlue webhook) | Handles the boss's texts: approve/pass, delete, research a company, update the thesis, run an on-demand sweep, or schedule a future check-in. Has a standing rule to save any genuine startup it surfaces during research — not just on explicit sweep requests. |
| `signals_review_agent` | `signals_review_scheduled` cron (daily 11:50pm ET) | Curates the day's raw signals at excerpt-level: deletes bad/duplicate/noise, schedules a re-check on the promising few. Built fresh per run (see `agent/signals_review.py`). |
| `feedback_agent` | Dashboard approve/pass reason submission | Distills a one-line dashboard reason into a reusable learning pattern. |

**Cross-agent context**: reflections (`write_reflection`) are namespaced by source (`text`, `feedback`) in
Supermemory so concurrent writers never clobber each other. Scheduled-task alerts (a promising signal
re-check, in the future) get appended to the SMS agent's own conversation history via
`append_alert_to_history`, so a follow-up text has that context without re-fetching it.

**Memory model (Supermemory containers)**: `vc:thesis`, `vc:preferences` (seek/avoid patterns),
`vc:startups`, `vc:reflections` (namespaced by source). Signals and scheduled tasks are **not** stored in
Supermemory — they live in Supabase (see below), intentionally kept out of every agent's standing context.

---

## Signals Pipeline (`agent/signals_scraper.py`, `agent/signals_review.py`)

A separate, higher-volume feed from scouting: crawls LinkedIn/X for early-stage AI startup signals, scores
them with regex heuristics, runs a final strict structured-output pass, then writes approved signals to the
dashboard's Signals tab (Supabase `signals` table) — capped at **50/day**, split **70% LinkedIn / 30% X** by
conviction score (`DAILY_SIGNAL_CAP`/`LINKEDIN_SHARE` in `signals_scraper.py`). `scrape_and_filter_frequent`
runs every 2h and skips crawling entirely once the day's cap is already met, saving the search/embedding/
Gemma cost, not just the write.

**Quality filter**: after the regex scoring pass, candidates go through `gemma_filter` — **Gemma 4**
(`gemma-4-31b`) hosted on **Cerebras**, called via its OpenAI-compatible `/v1/chat/completions` endpoint with
`json_schema`-constrained structured output (genuine schema enforcement, not just a prompt asking nicely for
JSON). The filter prompt is deliberately strict: named startup/founder, real commercial AI product,
undeniably early-stage (including founders actively building in stealth or just out of it), no significant
press coverage, US-based, under $10M raised / under 20 people for social posts specifically.

**Daily review**: once a day, `signals_review_agent` (`agent/signals_review.py`) reads every `status='new'`
signal at excerpt-level — no deep research — and calls `delete_signals` on anything bad/duplicate/noise, and
`schedule_signal_check` on the handful worth revisiting (capped at 5 schedules/run, 2 re-checks/signal ever,
re-checks spaced ≥7 days apart via `agent/scheduler.py`). A fired re-check runs one fresh Exa search + one
Gemma call scoped to that company; if conviction clears the bar it's re-surfaced and you get a text, silent
otherwise.

---

## Supabase Schema

Supabase is a **read-only mirror** of Supermemory for the dashboard (kept in sync by `agent/sync.py`, run
both on a 30-min cron and on-demand after every scout/feedback event) plus the `signals` and `cache` tables,
which are written directly (no Supermemory involved).

- `startups`: name, slug, one-liner, assessment, status (`new`/`approved`/`passed`), signal URLs, and
  enrichment fields (company description, founders, stage, raised, location, team size) populated by the
  on-demand enrichment job.
- `thesis`: the active investment thesis markdown content.
- `signals`: platform (LinkedIn / X (Twitter)), category, signal type, score, and the Gemma filter's approval
  reasoning for every approved signal. Auto-archives (`status: dismissed`) anything older than 3 days on
  every scrape.
- `scheduled_tasks`: the agent's self-scheduling table (`kind`, `due_at`, `payload`, `status`) — see
  `agent/scheduler.py` and `scripts/migrate-scheduled-tasks.sql`.
- `cache`: a general-purpose cache (Exa results, LLM outputs, SMS conversation history) — see `agent/cache.py`.

Full SQL schema (tables, indexes, RLS policies, realtime publication) is in `scripts/seed-supabase.py`. See
`scripts/migrations.sql`, `scripts/migrate-created-at.sql`, `scripts/migrate-signals-company-name.sql`, and
`scripts/migrate-scheduled-tasks.sql` for incremental migrations applied since.

---

## Dashboard (`src/`)

Next.js 16 + React 19 + Supabase, gated behind a single shared-password cookie (`src/proxy.ts`,
`src/app/login/`).

- **Tabs**: All / New / Approved / Passed / Signals, with live counts.
- **Realtime**: Supabase Postgres changes subscription for instant updates, falling back to polling if the
  public anon key isn't configured (`useLiveStartups`, `useLiveSignals`).
- **Command palette** (⌘K / Ctrl+K): fuzzy-search and jump to any startup.
- **Startup detail page**: full assessment, enrichment data, and an "Enrich" button that kicks off an
  async Modal job (founder/social research via Exa) without blocking the dashboard.
- **Signals panel**: browse approved LinkedIn/X signals, dismiss individually or clear all, or send a
  signal straight to the agent for deeper research (spawns a background SMS-agent turn).
- **Feedback**: approving/passing a startup from the dashboard can include a reason, which gets distilled
  into a learning pattern by `feedback_agent` and mirrored into Supermemory immediately (not just on the
  next periodic sync) so a quick dashboard click never gets silently reverted.

---

## Orchestration (Modal)

All serverless orchestration lives in `modal_app.py`. Warm containers (`min_containers=1`) are kept on
interactive/scheduled endpoints to cut cold-start latency; timeouts are generous since agent turns involve
real web research.

| Function | Trigger | Timeout | Description |
|---|---|---|---|
| `signals_scheduled` | Cron, every 2h | 30 min | LinkedIn/X signal scrape + Gemma filter, capped at 50/day |
| `signals_review_scheduled` | Cron, daily 11:50pm ET | 10 min | `signals_review_agent` curates the day's signals |
| `scheduled_tasks_poller` | Cron, every 20 min | 10 min | Pops due self-scheduled tasks (signal re-checks, follow-up texts) |
| `sync_scheduled` / `sync_on_demand` | Cron (30 min) / on-demand | 5 min | Mirrors Supermemory → Supabase |
| `enrich_startup` | Dashboard POST | 1 min | Kicks off `enrich_startup_job` in the background |
| `submit_feedback` | Dashboard POST | 5 min | Runs `feedback_agent` on an approve/pass reason |
| `send_signal_to_agent` | Dashboard POST | 5 min | Spawns a background SMS-agent research turn on a signal |
| `sendblue_webhook` | SMS webhook | 20 min | Validates the sender, spawns `chat_reply_background` |
| `chat_reply_background` | Webhook spawn | 20 min | Runs `text_agent`, sends the reply/tapback, syncs |

---

## Setup & Deployment

### 1. Database Setup
1. Spin up a Supabase project.
2. Run the SQL schema at the top of [`scripts/seed-supabase.py`](scripts/seed-supabase.py) in the SQL Editor.
3. Apply `scripts/migrations.sql`, `scripts/migrate-created-at.sql`, `scripts/migrate-signals-company-name.sql`,
   and `scripts/migrate-scheduled-tasks.sql` if starting from an older schema.

### 2. Environment Variables

See [`.env.example`](.env.example) for the full annotated list. Two runtimes need env vars:

#### Modal (Backend Secrets)
Create/update the `vc-scout-secrets` Modal secret:
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
  CEREBRAS_API_KEY=your_cerebras_key
```

Deploy with:
```bash
modal deploy modal_app.py
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

---

## Repository Layout

```
agent/                Python agents, tools, and the signals scraper (deployed to Modal)
  agent.py             Agent definitions, tool registry, orchestration (run_text_handler, ...)
  memory_store.py      Supermemory read/write layer (thesis, preferences, startups, reflections)
  signals_scraper.py   LinkedIn/X signal crawler + regex scoring + Gemma structured-output filter
  signals_review.py    Daily signals_review_agent: deletes noise, schedules re-checks
  scheduler.py          Supabase-backed self-scheduling primitive (scheduled_tasks table)
  llm.py               Model/settings config, retry logic
  cache.py             Supabase-backed cache (Exa results, LLM outputs, SMS conversation history)
  sync.py              Supermemory -> Supabase mirror
  enrich.py            Founder/company enrichment structuring
  tools/               Exa and Linkup client wrappers
modal_app.py           All Modal function definitions, crons, and web endpoints
src/app/               Next.js dashboard (App Router), API routes, components, hooks
src/lib/               Supabase clients, Supermemory REST helper, shared types
scripts/               Supabase schema + migrations, Supermemory seeding
```
