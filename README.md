# VC Research Agent

Automated pre-seed startup scout. A Python agent (Pydantic AI + MiniMax on NVIDIA NIM) discovers and scores early-stage AI companies, persists everything to cloud memory, and surfaces results on a Next.js dashboard. Optional iMessage chat via SendBlue.

**Live:** [startup-scout-agent.vercel.app](https://startup-scout-agent.vercel.app)

## How it works

```
┌──────────────────┐   cron every 4h PT    ┌──────────────────┐
│  Trigger.dev     │◄──────────────────────│  research-sweep  │
│                  │                       └──────────────────┘
│  Python agent    │◄── POST /api/trigger ─┌──────────────────┐
│  (agent/main.py) │                       │  Next.js (Vercel) │
│                  │◄── SendBlue webhook ──│  dashboard        │
└────────┬─────────┘                       └──────────────────┘
         │
         ├── load brain.json (Vercel Blob)
         ├── run agent (Exa search → score → save)
         ├── save brain.json back to Blob
         └── iMessage reply (SendBlue, optional)
```

Every run follows the same path:

1. **Load memory** — `brain.json` is read from Vercel Blob (startups, seen URLs, notes, run history).
2. **Inject context** — `brain/thesis.md` + rendered brain state go into the system prompt.
3. **Research** — the agent uses Exa (`exa_search`, `social_search`, `exa_get_contents`) to find candidates, `score_startup` to rate them, and `save_startup` / `mark_seen` / `remember` to update memory.
4. **Persist** — the updated brain is written back to Blob.
5. **Notify** — sweep summaries and chat replies are sent via SendBlue iMessage (if configured).

The dashboard reads the same `brain.json` and shows startups sorted by score. No database.

## Triggers

| Trigger | How | Task |
|---|---|---|
| **Cron** | Every 4 hours PT | `research-sweep` |
| **Manual** | Dashboard "Run now" → `POST /api/trigger` | `research-sweep` |
| **Chat** | Text your SendBlue number → `POST /api/webhooks/sendblue` | `chat-reply` |

Chat is owner-only: only `ALERT_PHONE_NUMBER` can talk to the agent.

## Project structure

```
agent/              Python agent (Pydantic AI, tools, in-memory brain)
  agent.py            Model, system prompt, sweep/chat modes
  brain.py            Brain mutations + prompt rendering
  main.py             CLI entrypoint (JSON in → JSON out)
  tools/              Exa search, scorer
brain/
  thesis.md           Investment criteria (bundled into Trigger.dev deploy)
lib/
  blob.ts             loadBrain / saveBrain (Vercel Blob)
  sendblue.ts           Outbound iMessage
src/
  trigger/agent.ts    Trigger.dev tasks (research-sweep, chat-reply)
  app/                Next.js dashboard + API routes
```

## Environment variables

Two runtimes. Copy `.env.example` → `.env` locally and set everything there for dev.

### Trigger.dev (Production) — where the Python agent runs

| Variable | Required | Purpose |
|---|---|---|
| `NVIDIA_API_KEY` | yes | LLM via NVIDIA NIM (`minimaxai/minimax-m3`) |
| `EXA_API_KEY` | yes | Web + LinkedIn search |
| `BLOB_READ_WRITE_TOKEN` | yes | Read/write `brain.json` in Vercel Blob |
| `SENDBLUE_API_KEY` | for iMessage | Outbound alerts + chat replies |
| `SENDBLUE_API_SECRET` | for iMessage | Outbound alerts + chat replies |
| `ALERT_PHONE_NUMBER` | for iMessage | Your phone number (E.164, e.g. `+16615551234`) |
| `LOGFIRE_TOKEN` | no | Pydantic Logfire tracing |

Set these in the [Trigger.dev dashboard](https://cloud.trigger.dev) → your project → Environment Variables → Production. Redeploy after changes: `npm run deploy`.

### Vercel (Production) — dashboard + webhooks

| Variable | Required | Purpose |
|---|---|---|
| `TRIGGER_SECRET_KEY` | yes | Trigger tasks from the dashboard (`tr_prod_…`) |
| `BLOB_READ_WRITE_TOKEN` | yes | Dashboard reads startups from Blob |
| `ALERT_PHONE_NUMBER` | for chat | Owner check on inbound SendBlue webhook |
| `SENDBLUE_*` | no | Not needed on Vercel (outbound runs on Trigger.dev) |

Vercel auto-sets `BLOB_STORE_ID` when you connect a Blob store. On Vercel itself, OIDC auth can replace the static blob token; Trigger.dev still needs `BLOB_READ_WRITE_TOKEN` because it runs off-platform.

### Local dev

Use `tr_dev_…` for `TRIGGER_SECRET_KEY`. All other vars same as production.

## Setup

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in keys
```

**Blob store** — create a private store and connect it to the Vercel project:

```bash
vercel link
vercel blob create-store vc-agent-brain --access private --yes --environment production
```

Copy `BLOB_READ_WRITE_TOKEN` when it's shown (one-time). Add it to Trigger.dev and your local `.env`.

**Trigger.dev:**

```bash
npx trigger.dev@latest login
npm run deploy
```

Copy the production secret key (`tr_prod_…`) into Vercel as `TRIGGER_SECRET_KEY`.

**SendBlue (optional):** set the receive webhook to:

```
https://startup-scout-agent.vercel.app/api/webhooks/sendblue
```

## Running locally

Two terminals:

```bash
npm run dev          # Trigger.dev dev server (runs the agent)
npm run next:dev     # Dashboard at http://localhost:3000
```

Hit "Run now" on the dashboard or wait for the cron in the Trigger.dev dev UI.

## Deploying

| Command | What it deploys |
|---|---|
| `npm run deploy` | Trigger.dev tasks (agent + cron). Run after any agent or env change. |
| `git push` | Vercel (Next.js dashboard). Auto-deploys if repo is connected. |

These are independent — pushing to git does **not** redeploy Trigger.dev.

## Agent behavior

**Sweep mode** (cron / manual): runs broad Exa + LinkedIn queries, enriches top candidates, scores against the thesis, saves startups scoring ≥ 50, and sends a short iMessage summary.

**Chat mode** (SendBlue): answers from memory, runs tools on request, remembers preferences via `remember`.

**Scoring:**

| Score | Action |
|---|---|
| ≥ 50 | Saved to brain |
| ≥ 75 | Highlighted in sweep summary |

## Memory

All dynamic state lives in one file: `brain.json` on Vercel Blob.

| Field | Contents |
|---|---|
| `startups` | Scored startup dossiers (keyed by slug) |
| `seen_urls` | URLs already processed (dedup) |
| `notes` | Freeform insights / user preferences |
| `conversation` | Recent chat history |
| `runs` | Sweep summaries + timestamps |
| `updated` | Last write timestamp |

Static thesis text is in `brain/thesis.md` (bundled at deploy time). Legacy markdown files in `brain/` (`shortlist.md`, etc.) are not used by v4.
