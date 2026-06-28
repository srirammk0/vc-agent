# VC Research Agent

An automated pre-seed startup scout that discovers, scores, and surfaces early-stage AI companies. A Python agent (Pydantic AI + DeepSeek V4 on NVIDIA NIM) runs on Trigger.dev; a Next.js dashboard on Vercel provides a manual trigger and Firecrawl webhook receiver.

## Architecture

```
┌─────────────────┐     cron (every 4h PT)     ┌──────────────────┐
│  Trigger.dev    │◄────────────────────────────│  vc-scout-cron   │
│                 │                             └──────────────────┘
│  vc-scout task  │◄──── POST /api/trigger ─────┌──────────────────┐
│  (spawns Python)│                             │  Next.js (Vercel) │
│                 │◄── POST /api/webhooks/ ─────│  dashboard        │
└────────┬────────┘    firecrawl               └──────────────────┘
         │
         ▼
┌─────────────────┐     Exa search + enrich     ┌──────────────────┐
│  agent/         │────────────────────────────►│  Exa.ai          │
│  main.py        │                             └──────────────────┘
│  (Pydantic AI)  │     score + write           ┌──────────────────┐
│                 │────────────────────────────►│  brain/ (markdown)│
│                 │     iMessage alerts (≥75)   └──────────────────┘
└─────────────────┘────────────────────────────► SendBlue
```

### Agent pipeline

1. **Discovery** — `exa_search` and `social_search` run 6–8 web queries and 3–4 social queries per sweep.
2. **Enrichment** — `exa_get_contents` fetches full page content for promising candidates (5–8 URLs max per run).
3. **Deduplication** — known startups are loaded from `brain/index.md` and skipped.
4. **Scoring** — `score_startup` rates each startup 0–100 across founder pedigree, AI-native fit, stage, recency, traction, and geo.
5. **Persistence** — startups scoring ≥ 50 are written to `brain/startups/` via `write_startup`; the index is updated after each run.
6. **Alerts** — startups scoring ≥ 75 trigger iMessage alerts via SendBlue.

### Triggers

| Trigger | Source | Behavior |
|---|---|---|
| `manual` | Dashboard "Run now" button → `/api/trigger` | Full discovery sweep |
| `cron` | `vc-scout-cron` — every 4 hours PT | Full discovery sweep |
| `firecrawl_monitor` | Firecrawl webhook → `/api/webhooks/firecrawl` | Enrich the changed page first, then targeted queries |

Firecrawl monitors are configured in the Firecrawl dashboard (no API key in the agent). The webhook URL is your Vercel deployment at `/api/webhooks/firecrawl`.

## Project structure

```
agent/           Python agent (Pydantic AI, tools, brain I/O)
brain/           Markdown knowledge base (thesis, index, per-startup files)
src/
  trigger/       Trigger.dev task definitions
  app/           Next.js dashboard + API routes
lib/             Shared TS utilities (brain reader, SendBlue)
```

## Setup

### 1. Install dependencies

```bash
npm install
pip install -r requirements.txt
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in the keys. Two runtimes need env vars:

| Runtime | Where to set | What runs there |
|---|---|---|
| **Trigger.dev** | Trigger.dev dashboard → Environment Variables | Python agent (LLM, Exa, SendBlue, Logfire) |
| **Vercel** | Vercel project settings | Next.js app (run button, Firecrawl webhook) |

Locally, set everything in `.env` so `npm run dev` works end-to-end. See `.env.example` for the full list and which runtime each var belongs to.

### 3. Trigger.dev

The project is wired to `proj_zkqctocaqceqitxjtbar` in `trigger.config.ts`.

```bash
npx trigger.dev@latest login
npm run deploy          # deploy tasks to Trigger.dev cloud
```

After deploying, copy the production `TRIGGER_SECRET_KEY` (`tr_prod_…`) into Vercel so the dashboard can trigger runs.

### 4. Firecrawl webhook (optional)

In the Firecrawl dashboard, point your monitor's webhook at:

```
https://<your-vercel-domain>/api/webhooks/firecrawl
```

Set `FIRECRAWL_WEBHOOK_SECRET` on Vercel to match the `x-firecrawl-secret` header on the monitor. Optionally set `FIRECRAWL_MONITOR_ID` and `FIRECRAWL_MONITOR_NAME` for friendlier agent context.

## Running locally

**Trigger.dev dev server** (runs the agent when tasks are triggered):

```bash
npm run dev
```

**Next.js dashboard** (separate terminal):

```bash
npm run next:dev
```

Trigger a manual run from the dashboard at `http://localhost:3000`, or from the Trigger.dev dev UI.

## Deploying

| Command | What it deploys |
|---|---|
| `npm run deploy` | Trigger.dev tasks only (agent + cron) |
| `git push` | Vercel (Next.js app) if the repo is connected — does **not** redeploy Trigger.dev |

A README-only push may still trigger a Vercel rebuild, but it won't change agent behavior. To update the agent or cron schedule, run `npm run deploy`.

## Brain / deduplication

The `brain/` directory is the agent's memory:

- `brain/thesis.md` — investment criteria passed to the LLM each run
- `brain/index.md` — table of all known startups (used for dedup)
- `brain/startups/<slug>.md` — per-startup dossiers
- `brain/run-log.md` — append-only log of every run

When the index grows large (~500+ entries), consider migrating dedup to Postgres (Supabase/Neon) and querying by URL instead of loading the full index into context.

## Scoring thresholds

| Score | Action |
|---|---|
| ≥ 50 | Written to brain |
| ≥ 75 | iMessage alert via SendBlue |
