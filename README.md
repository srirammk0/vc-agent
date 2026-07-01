# VC Research Agent (V5)

Automated pre-seed startup scout. A fully autonomous Python agent (Pydantic AI + Anthropic Claude 3.5 Sonnet) discovers and scores early-stage AI companies, persists state and memory to **Supabase**, and surfaces results on a Next.js dashboard. Orchestrated by **Modal** with warm containers and 20-minute timeouts.

**Live:** [startup-scout-agent.vercel.app](https://startup-scout-agent.vercel.app)

---

## How it Works

```text
┌──────────────────┐   cron every 4h PT    ┌──────────────────┐
│  Modal           │◄──────────────────────│ scout_scheduled  │
│                  │                       └──────────────────┘
│  Python agent    │◄── POST /enrich_start─┌──────────────────┐
│  (agent/main.py) │                       │ Next.js (Vercel) │
│                  │                       │ dashboard        │
│  Supabase DB     │                       └──────────────────┘
│  (Persisted)     │◄── SendBlue webhook ── (Inbound SMS)
└────────┬─────────┘
         │
         ├── read/write thesis, patterns, & runs to Supabase
         ├── run agent (Exa deep search → score & filter)
         ├── autonomously save new startups to DB (status: 'new')
         └── send/receive iMessage replies (SendBlue)
```

1. **Load Memory & Thesis**: The agent loads its core thesis, approved startup patterns, and passed startup patterns directly from Supabase tables (`thesis`, `learning_patterns`).
2. **Scheduled Sweep**: Every 4 hours, a scheduled Modal cron job triggers the texting agent with a system prompt: *"Execute a scheduled scouting sweep..."*
3. **Deep Web Research**: The agent uses a high-performance `exa_deep_search` tool. In a single parallelized request, it queries Exa for early-stage AI startups and fetches the full text content of promising domains.
4. **Autonomous Scoring & Filtering**: The agent scores each candidate against the thesis and hard filters (traction signals, obscurity, funding limits).
5. **DB Persistence**: If a candidate passes, the agent calls `save_new_startup` to insert it into Supabase with `status='new'` (pending approval).
6. **iMessage Loop**: You can query the database, approve/pass startups, update your thesis, add learning patterns, or send tapbacks directly via SMS conversation.

---

## Supabase Database Schema

The database consists of 5 tables:
- `startups`: Stores name, slug, one-liner, what they do, team details, score breakdowns, status (`new`, `approved`, `passed`), and enrichment data.
- `thesis`: Stores the active investment thesis markdown content and `updated_at` timestamp.
- `learning_patterns`: Guide the agent's query generation and scoring (contains `type` `approved` or `passed`).
- `runs`: History log of scouting runs and enrichment events.
- `founders`: Profile backgrounds for scraped founders.

See the complete schema definition in `scripts/seed-supabase.py`.

---

## Setup & Deployment

### 1. Database Setup
1. Spin up a Supabase project.
2. Go to the SQL Editor and run the SQL schema defined at the top of [scripts/seed-supabase.py](file:///Users/sriram.mk/Documents/ECs/Internships/StudioRTF%20Internship/vc/scripts/seed-supabase.py).
3. Ensure service_role and anon permissions are granted (the schema SQL does this).

### 2. Environment Variables

#### Modal (Backend Secrets)
Create a secret named `vc-scout-secrets` in your Modal dashboard or via CLI:
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

#### Vercel / Next.js (`.env.local`)
See `.env.example` for the full list. The dashboard is currently a clean slate
(auth + scaffold only) pending the next iteration.

---

## Orchestration (Modal)

Trigger.dev and Vercel Blobs are fully removed. Modal handles all serverless orchestration:
- **Warm Containers**: Keeps a container warm (`min_containers=1`) on all interactive endpoints to reduce cold start latency.
- **Extended Timeouts**: Timeout limits are set to **20 minutes (1200s)** across all functions to give the agent plenty of runway for deep web research.

| Function | Trigger | Timeout | Description |
|---|---|---|---|
| `scout_scheduled` | Cron (Every 4h) | 20 mins | Triggers the texting agent to run a deep sweep |
| `enrich_startup` | Dashboard POST | 20 mins | Scrapes founder/social writing for approved startups |
| `sendblue_webhook` | SMS Webhook | 20 mins | Receives and routes your texts to the agent |
| `chat_reply_background` | Webhook Spawn | 20 mins | Processes agent reasoning and replies/tapbacks |

---

## Local Development

1. Install local dependencies:
   ```bash
   npm install
   pip install -r requirements.txt
   ```
2. Populate the Supabase database with your local brain state:
   ```bash
   python3 scripts/seed-supabase.py
   ```
3. Run the Next.js local server:
   ```bash
   npm run dev
   ```
