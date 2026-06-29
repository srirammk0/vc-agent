# VC Research Agent (V5)

Automated pre-seed startup scout. A Python agent (Pydantic AI + DeepSeek V4 Pro on NVIDIA NIM) discovers and scores early-stage AI companies, persists everything to cloud memory (Vercel Blob via Markdown files), and surfaces results on a Next.js dashboard. Orchestrated by Modal.

**Live:** [startup-scout-agent.vercel.app](https://startup-scout-agent.vercel.app)

## How it works

```text
┌──────────────────┐   cron 7am/6pm PT     ┌──────────────────┐
│  Modal           │◄──────────────────────│ scout_scheduled  │
│                  │                       └──────────────────┘
│  Python agent    │◄── POST /scout_demand ┌──────────────────┐
│  (agent/main.py) │                       │ Next.js (Vercel) │
│                  │◄── POST /enrich_start─│ dashboard        │
│                  │                       └──────────────────┘
│                  │◄── SendBlue webhook ── (Inbound SMS)
└────────┬─────────┘
         │
         ├── sync markdown state to/from Vercel Blob
         ├── run agent (Exa search → score → enrich)
         └── send iMessage reply (SendBlue, optional)
```

1. **Load memory** — The `/brain` folder locally is populated/synced from Vercel Blob (startups, founders, learning patterns).
2. **Inject context** — `brain/thesis.md` + learned patterns go into the system prompt.
3. **Research** — The agent uses Exa (`company`, `people`, `x`, `linkedin`) to find candidates and `score_startup` to rate them based on obscurity and traction.
4. **Persist** — The updated markdown files are synced back to Blob.
5. **Notify** — Alerts and chat replies are sent via SendBlue iMessage.

The Next.js dashboard reads the same Vercel Blob to display startups sorted by score. No database.

## Orchestration (Modal)

Trigger.dev has been completely removed in favor of **Modal** for sub-second cold starts and highly scalable orchestration.

| Endpoint | Trigger | What it does |
|---|---|---|
| `scout_scheduled` | Cron (7am, 6pm PT) | Daily deep-dive Exa scout |
| `scout_on_demand` | Dashboard POST | Manual scout |
| `enrich_startup` | Dashboard POST | Deep Exa company/people research |
| `sendblue_webhook` | SMS Webhook | Chat and approve/pass commands via SMS |

## Environment variables

Because Modal runs the backend agent and Vercel runs the frontend dashboard, secrets are split.

### Modal (Backend Secrets)

Set these via `modal secret create vc-scout-secrets [KEY=VALUE ...]`:

| Variable | Purpose |
|---|---|
| `NVIDIA_API_KEY` | LLM via NVIDIA NIM (DeepSeek V4 Pro) |
| `EXA_API_KEY` | Web, company, people, and social search |
| `FIRECRAWL_API_KEY` | Web scraping (if used by tools) |
| `BLOB_READ_WRITE_TOKEN` | Read/write markdown state to Vercel Blob |
| `SENDBLUE_API_KEY` | Outbound alerts + chat replies |
| `SENDBLUE_API_SECRET` | Outbound alerts + chat replies |
| `ALERT_PHONE_NUMBER` | Your phone number (E.164, e.g. `+16615551234`) |
| `LOGFIRE_TOKEN` | Pydantic Logfire tracing |

### Vercel / Next.js (Frontend `.env.local`)

| Variable | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Dashboard reads startups from Blob |
| `MODAL_SCOUT_URL` | URL to trigger manual scout |
| `MODAL_ENRICH_URL` | URL to trigger enrichment |

*(The `MODAL_WEBHOOK_URL` goes directly into your SendBlue dashboard settings, bypassing Vercel completely).*

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   pip install -r requirements.txt
   ```

2. **Blob store:**
   Create a private store and connect it to the Vercel project:
   ```bash
   vercel link
   vercel blob create-store vc-agent-brain --access private --yes --environment production
   ```
   Add `BLOB_READ_WRITE_TOKEN` to your Vercel project and Modal secrets.

3. **Deploy Modal:**
   ```bash
   modal setup
   modal secret create vc-scout-secrets NVIDIA_API_KEY=... EXA_API_KEY=... BLOB_READ_WRITE_TOKEN=...
   modal deploy modal_app.py
   ```
   *Take the URLs printed by Modal and add them to your Vercel `.env.local`.*

4. **SendBlue (optional):**
   Set the receive webhook to the Modal URL:
   ```
   https://[your-modal-app].modal.run/sendblue_webhook
   ```

## Local Dev

```bash
npm run dev          # Next.js Dashboard at http://localhost:3000
```
*(The backend agent runs entirely serverless on Modal now — no local agent server needed!)*

## Memory Architecture (V5)

The monolithic `brain.json` is gone. State is now a series of markdown files managed by `lib/brain.ts` and synced to Vercel Blob:
- `brain/thesis.md`
- `brain/startups/[slug].md`
- `brain/founders/[slug].md`
- `brain/learning/approved-patterns.md`
- `brain/learning/passed-patterns.md`
