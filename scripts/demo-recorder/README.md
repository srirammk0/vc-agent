# Demo video recorder

A pre-built walkthrough is committed as [`demo.mp4`](./demo.mp4) (~5.5 MB, ~90 s).
Use the steps below only if you want to regenerate it after UI changes.

Records a polished, silent walkthrough of the dashboard — login, dealflow list,
filters/search/command palette, a startup detail panel, batch approve + undo,
Speed Review, the per-row outreach menu, Agent Chat (with a tool-call trace),
and the Scheduled Runs panel.

It runs against **mocked data**, not your real Supabase/Trigger.dev/Anthropic
backend:

- `mockData.js` seeds ~14 fictional startups and a handful of scheduled tasks.
- `record.js` intercepts every `/api/*` call the dashboard makes (via
  Playwright network routing) and serves that mock data instead — the real
  API routes never run, so no Supabase/Trigger.dev credentials are needed and
  nothing gets written anywhere real.
- `sse-server.js` is a tiny local server that plays back a scripted
  `/api/chat` SSE exchange (a question, a couple of tool calls, a streamed
  answer) so the Agent Chat tab has something real to show without an
  Anthropic key or an actual agent run.
- A generic request blocker aborts anything that isn't `localhost`/
  `127.0.0.1`, so a fictional company's `.com` never actually gets fetched
  into a live website-preview iframe mid-recording.

This is deliberately **not** pointed at a live/production deployment — the
whole point is a repeatable recording with safe, synthetic data instead of
whatever real dealflow happens to be in the database that day.

## Prerequisites

- The main app's dependencies installed (`npm install` at the repo root) and
  a production build (`npm run build`) — dev mode shows Next's build-activity
  indicator badge in the corner, which you don't want in the recording.
- `ffmpeg` on `PATH`.
- A Chrome/Chromium binary. Either:
  - point `DEMO_CHROME_PATH` at one you already have (e.g.
    `/usr/bin/google-chrome`), or
  - run `npx playwright install chromium` once (downloads Playwright's own
    build, no `DEMO_CHROME_PATH` needed).
- The Inter font family (Bold/SemiBold/Regular) if you want to regenerate the
  title/outro cards — any similar sans-serif works, just point `FONT_DIR` at
  it.

## Usage

From the repo root:

```bash
# 1. Build and start the app in production mode, with dummy backend creds
#    (nothing here needs to be real — every /api/* call gets intercepted).
cat > .env.local <<'EOF'
SUPABASE_URL=https://demo-placeholder.supabase.co
SUPABASE_SERVICE_ROLE_KEY=demo-placeholder-service-role-key
DASHBOARD_PASSWORD=demo-local-only
DASHBOARD_SESSION_SECRET=1111111111111111111111111111111111111111111111111111111111111111
TRIGGER_SECRET_KEY=demo-placeholder-trigger-key
EOF
npm run build
npm run start &   # serves http://localhost:3000

# 2. Install the recorder's own dependency (kept isolated from the main app).
cd scripts/demo-recorder
npm install

# 3. Start the fake chat SSE server used for the Agent Chat segment.
node sse-server.js &

# 4. Record. Produces video/*.webm.
DEMO_CHROME_PATH=/usr/bin/google-chrome node record.js

# 5. (Re)generate the title/outro cards, then stitch everything into one mp4.
FONT_DIR=/path/to/inter-fonts ./make-cards.sh
./assemble.sh    # writes demo.mp4
```

Clean up afterwards: kill the `npm run start` / `sse-server.js` background
processes, and delete the `.env.local` you created in step 1 (it's already
git-ignored, but it's only ever meant to exist for this recording).

## Config knobs (env vars, all optional)

| Var | Default | Purpose |
|---|---|---|
| `DEMO_BASE_URL` | `http://localhost:3000` | App URL to record against |
| `DEMO_DASHBOARD_PASSWORD` | `demo-local-only` | Must match `DASHBOARD_PASSWORD` from step 1 |
| `DEMO_VIDEO_DIR` | `./video` | Where Playwright writes the raw `.webm` |
| `DEMO_SSE_PORT` | `8791` | Port for the fake chat server (`sse-server.js`) |
| `DEMO_CHROME_PATH` | _(unset)_ | Path to a system Chrome/Chromium; omit to use Playwright's bundled one |

## Editing the tour

`record.js` is a single linear script — numbered comment blocks (`---- 1.
Login ----`, `---- 2. Dashboard: load data ----`, etc.) walk through each UI
moment in order. `moveTo`/`clickEl`/`typeSlowly` drive a custom animated
cursor (injected via `addInitScript`, not the real OS pointer — headless
Chrome doesn't render one) so the recording reads like an actual person
clicking through the product. Add, remove, or reorder steps there; add more
fictional companies or scheduled tasks in `mockData.js`.
