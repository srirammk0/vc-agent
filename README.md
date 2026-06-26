# Startup Scout Agent 🛰️

An automated agent that runs hourly from 6:00 AM to 6:00 PM Pacific Time to discover, evaluate, and surface high-quality early-stage startups.

## Architecture

1. **Trigger.dev** runs the scheduled job hourly between 6:00 AM and 6:00 PM Pacific Time (`src/trigger/startup-scout.ts`).
2. **Exa.ai** is queried using a rotating bank of search queries targeting AI infrastructure, fintech tooling, and founder pedigree.
3. **Local Deduplication & Hard Filters**: Startups are checked against `seen-startups.md` by URL, and rigorously filtered by stage, funding, headcount, and age.
4. **Exa.ai Enrichment**: The agent pulls website summaries, searches LinkedIn for founders and their prior roles, and runs 3 parallel signal searches (headcount, stability, traction) for up to 20 candidate startups.
5. **Gemini 3.1 Flash Lite Scoring**: The startup data and registry are passed to `gemini-3.1-flash-lite` for a strict 1-10 evaluation across 5 dimensions (founder_pedigree, technical_moat, thesis_fit, traction_signals, market_timing) using JSON Mode.
6. **Composio / Gmail**: Startups scoring $\geq 6.5/10$ overall and $\geq 6/10$ on thesis_fit are emailed directly to your inbox via a Composio-authenticated Gmail connection.
## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.example` to `.env` and fill in the keys:
   - `EXA_API_KEY`: From Exa dashboard
   - `GEMINI_API_KEY`: From Google AI Studio
   - `COMPOSIO_API_KEY`: From Composio dashboard
   - `COMPOSIO_USER_ID`: The User ID you used during Composio Gmail onboarding
   - `GMAIL_TO`: Where to send the debrief emails

3. **Trigger.dev Project**
   The `trigger.config.ts` is already wired to `proj_zkqctocaqceqitxjtbar`.
   Ensure you are logged in to the Trigger CLI:
   ```bash
   npx trigger.dev@latest login
   ```

## Running the Agent

**Local Dev**
Run the job locally, triggering it from the Trigger.dev dashboard:
```bash
npm run dev
```

**Deploy to Production**
Deploy the schedule to run automatically on Trigger.dev's cloud:
```bash
npm run deploy
```

## How Deduplication Works

The `seen-startups.md` file is committed to your repository. It acts as a lightweight database. When the agent runs, it reads the file into memory and passes it to the LLM context. 

If a startup passes the scoring threshold, it is appended to the bottom of the Markdown file. Over time, this file becomes an archive of every startup the agent has surfaced.

---

## Scaling to Postgres

> **Note**: When `seen-startups.md` exceeds ~500 entries, you will likely hit context length limits when passing it to Gemini. At that point, you should migrate to Postgres.
> 
> **Migration Steps**:
> 1. Set up a Supabase/Neon Postgres database.
> 2. Create the table:
>    ```sql
>    CREATE TABLE startups (
>      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>      name TEXT NOT NULL,
>      url TEXT NOT NULL UNIQUE,
>      founder_name TEXT,
>      founder_linkedin TEXT,
>      one_liner TEXT,
>      funding_stage TEXT,
>      overall_score NUMERIC(3,1),
>      red_flags_count INTEGER DEFAULT 0,
>      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
>    );
>    ```
> 3. Update `lib/dedup.ts` to `SELECT 1 FROM startups WHERE url = ?` instead of passing the full registry in-context.