# VC Research Agent

Automated pre-seed/seed AI startup scout. A set of Pydantic AI agents (Anthropic Claude Sonnet) research and
save early-stage AI companies, run a continuous multi-source signal feed, and text you about all of it —
persisted to **Supermemory** (the agent's brain) and mirrored to **Supabase** for a live Next.js dashboard.
Orchestrated by **Modal** with warm containers and scheduled crons.

**Live:** [startup-scout-agent.vercel.app](https://startup-scout-agent.vercel.app)

---

## How it Works

```text
┌───────────────────────┐   cron: every 4h        ┌──────────────────┐
│  Modal                │◄────────────────────────│ scout_scheduled  │
│                       │                          └──────────────────┘
│  agent/ (Python)      │   cron: Mon 6am ET       ┌──────────────────┐
│  - text_agent (SMS)   │◄────────────────────────│ news_digest_     │
│  - scout_agent        │                          │ scheduled        │
│  - news_agent         │                          └──────────────────┘
│  - feedback_agent     │   cron: every 30 min     ┌──────────────────┐
│                       │◄────────────────────────│ signals_scheduled │
│  Supermemory (brain)  │   cron: weekly           ┌──────────────────┐
│  Supabase (mirror)    │◄────────────────────────│ signals_          │
└───────┬───────────────┘                          │ directories_     │
        │                                          │ scheduled        │
        │                                          └──────────────────┘
        ├── SendBlue (inbound/outbound iMessage)
        ├── Exa (startup discovery, deep research)
        ├── Linkup (news, fund blogs, press checks)
        └── Gemma 4 on Modal (strict signal-quality filter)
                                                    ┌──────────────────┐
                                                    │ Next.js (Vercel) │
                                                    │ dashboard        │
                                                    └──────────────────┘
```

1. **Load memory**: every agent loads the live investment thesis and learned seek/avoid patterns directly
   from Supermemory before it does anything.
2. **Scheduled scout sweep** (every 4h): searches Exa for pre-seed AI startups, filters against the thesis,
   and saves survivors with `status: new`.
3. **Weekly market brief** (Monday mornings): reads VC news, fund blogs, and prominent investor writing via
   Linkup, saves a structured digest, and texts you the top links.
4. **Signals feed**: two crons continuously crawl launch/hiring/portfolio sources (see below), score them
   with regex heuristics, and run a final strict LLM pass before writing them to the dashboard's Signals tab.
5. **iMessage loop**: text the agent directly — approve/pass startups, ask what the scout or news digest
   found, update the thesis, or just ask it to research something. It saves what it finds.
6. **Dashboard**: approve/pass/enrich startups, browse and dismiss signals, all live via Supabase realtime.

---

## Agents (`agent/agent.py`)

All four agents share the same Anthropic Claude Sonnet model and tool registry
(`register_tools` in `agent/agent.py`), just with different system prompts and which tools are enabled.

| Agent | Trigger | Purpose |
|---|---|---|
| `text_agent` | Inbound SMS (SendBlue webhook) | Handles the boss's texts: approve/pass, delete, research a company, update the thesis, run an on-demand sweep. Has standing context on what the scout and news digest found, and a standing rule to save any genuine startup it surfaces during research — not just on explicit sweep requests. |
| `scout_agent` | `scout_scheduled` cron (every 4h) | Autonomous sweep: search Exa broadly, filter against the thesis, save survivors in one batch, then log learned patterns. Runs the same decisive search-and-save process as the SMS agent's "find me startups" flow — deliberately kept in sync so scheduled sweeps find just as much as an on-demand ask. |
| `news_agent` | `news_digest_scheduled` cron (Monday 6am ET) | Weekly VC market-intel brief across three buckets: industry news, fund blogs, individual investors/substacks. Cannot edit the thesis (hard filters are fixed); only writes soft seek/avoid patterns. |
| `feedback_agent` | Dashboard approve/pass reason submission | Distills a one-line dashboard reason into a reusable learning pattern. |

**Cross-agent context**: reflections (`write_reflection`) are namespaced by source (`scout`, `news`, `text`,
`feedback`) in Supermemory so concurrent writers never clobber each other. The SMS agent's system prompt
loads the latest scout sweep notes and the latest weekly market brief on every turn, so "what did the scout
find" or "what was in this week's brief" gets answered directly without a tool call. The scheduled scout and
news-digest SMS alerts are also appended to the SMS agent's own conversation history, so a follow-up text has
that context too.

**Memory model (Supermemory containers)**: `vc:thesis`, `vc:preferences` (seek/avoid patterns),
`vc:startups`, `vc:reflections` (namespaced by source), `vc:market-intel` (weekly briefs). Signals are
**not** stored in Supermemory — they go straight to Supabase (see below), and are intentionally kept out of
every agent's context.

---

## Signals Pipeline (`agent/signals_scraper.py`)

A separate, higher-volume feed from scouting: crawls launch/hiring/portfolio sources for early-stage AI
signals, scores them with regex heuristics, then runs a final strict structured-output pass before writing
approved signals to the dashboard's Signals tab (Supabase `signals` table).

Split into two crons based on how often each source class actually changes:

| Pipeline | Cadence | Sources |
|---|---|---|
| `scrape_and_filter_frequent` | Every 30 min | LinkedIn/X posts, GitHub trending, Show HN (points-scored, filters out bare GitHub-repo links and hobby/toy-phrased titles), Hugging Face Spaces, Work at a Startup (best-effort YC-batch filter for recent companies) |
| `scrape_and_filter_directories` | Weekly (Monday) | YC Launches, South Park Commons, Neo, Founders Inc — portfolio/launch pages that don't meaningfully change every 30 minutes. South Park Commons and Founders Inc additionally filter for companies founded 2025+. |

**Quality filter**: after the regex scoring pass, candidates go through `gemma_filter` — a self-hosted
**Gemma 4** SGLang server on Modal, called via its OpenAI-compatible `/v1/chat/completions` endpoint with
`json_schema`-constrained structured output (genuine schema enforcement, not just a prompt asking nicely for
JSON). The filter prompt is deliberately strict: named startup, real commercial AI product, undeniably
early-stage, no significant press coverage, US-based. Replaces an earlier Gemini 3.1 Flash Lite pass.

Reaching the Gemma endpoint requires Modal's own tunnel proxy auth (`Modal-Key`/`Modal-Secret` headers from
`modal token new`) in addition to the endpoint URL — see Environment Variables below.

---

## Supabase Schema

Supabase is a **read-only mirror** of Supermemory for the dashboard (kept in sync by `agent/sync.py`, run
both on a 30-min cron and on-demand after every scout/feedback event) plus the `signals` and `cache` tables,
which are written directly (no Supermemory involved).

- `startups`: name, slug, one-liner, assessment, status (`new`/`approved`/`passed`), signal URLs, and
  enrichment fields (company description, founders, stage, raised, location, team size) populated by the
  on-demand enrichment job.
- `thesis`: the active investment thesis markdown content.
- `signals`: platform, category, signal type, score, and the Gemma filter's approval reasoning for every
  approved signal. Auto-archives (`status: dismissed`) anything older than 3 days on every scrape.
- `cache`: a general-purpose cache (Exa results, LLM outputs, SMS conversation history) — see `agent/cache.py`.

Full SQL schema (tables, indexes, RLS policies, realtime publication) is in `scripts/seed-supabase.py`. See
`scripts/migrations.sql` and `scripts/migrate-created-at.sql` for incremental migrations applied since.

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
- **Signals panel**: browse approved signals by category, dismiss individually or clear all, or send a
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
| `scout_scheduled` | Cron, every 4h | 20 min | Autonomous scout sweep; texts a report and appends it to SMS conversation history |
| `news_digest_scheduled` | Cron, Mon 6am ET | 20 min | Weekly market-intel brief; same alert-to-history behavior |
| `signals_scheduled` | Cron, every 30 min | 30 min | Fast-moving signal sources (social, GitHub, Show HN, Hugging Face, hiring) |
| `signals_directories_scheduled` | Cron, weekly (Mon) | 15 min | Slow-moving accelerator/portfolio directories (YC, SPC, Neo, F.inc) |
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
3. Apply `scripts/migrations.sql` and `scripts/migrate-created-at.sql` if starting from an older schema.

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
  MODAL_GEMMA_URL=your_gemma_sglang_endpoint \
  MODAL_PROXY_KEY=your_modal_token_id \
  MODAL_PROXY_SECRET=your_modal_token_secret
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
  agent.py             Agent definitions, tool registry, orchestration (run_scout, run_text_handler, ...)
  memory_store.py      Supermemory read/write layer (thesis, preferences, startups, reflections, briefs)
  signals_scraper.py   Multi-source signal crawlers + regex scoring + Gemma structured-output filter
  news_digest.py        Monitored sources and Linkup search specs for the weekly brief
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
