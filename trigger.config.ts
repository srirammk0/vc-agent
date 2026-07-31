import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { pythonExtension } from "@trigger.dev/python/extension";
import { config as loadEnv } from "dotenv";

loadEnv();

const TRIGGER_SYNC_KEYS = [
  "ANTHROPIC_API_KEY",
  "EXA_API_KEY",
  "LINKUP_API_KEY",
  "CLAY_API_KEY",
  "SUPERMEMORY_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TRIGGER_SECRET_KEY",
  "LOGFIRE_TOKEN",
] as const;

// Trigger.dev owns both scheduling (one-off delayed triggers — see
// agent/trigger_client.py) and running the agent's Python: the one task in
// src/trigger/ shells out to agent/main.py via the pythonExtension below,
// whichever way it was triggered (immediately from a dashboard route, or later
// via a delayed REST trigger). No Modal, no other compute platform — this and
// api/chat.py on Vercel (web chat only, unchanged) are the only two places
// agent/ code runs. See README.md "Orchestration (Trigger.dev)".
export default defineConfig({
  project: "proj_zkqctocaqceqitxjtbar",

  dirs: ["./src/trigger"],

  // Was 60s (fine when every task was a thin fetch() to Modal). A run through
  // the actual agent can involve real web research across several tool calls —
  // matches modal_app.py's old run_scheduled_check timeout (600s).
  maxDuration: 600,

  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      factor: 1.5,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      randomize: true,
    },
  },

  build: {
    extensions: [
      // Push local .env secrets into Trigger.dev on deploy so production runs
      // have the same keys as Vercel (agent API keys, Supabase, TRIGGER_SECRET_KEY).
      syncEnvVars(async () =>
        TRIGGER_SYNC_KEYS
          .filter((name) => process.env[name])
          .map((name) => ({ name, value: process.env[name]!, isSecret: true }))
      ),
      // Installs Python + requirements.txt into the task's build container and
      // bundles agent/**/*.py alongside the Node build, so python.runScript can
      // shell out to agent/main.py. Config shape (requirementsFile/scripts) and
      // python.runScript's signature/return type are verified against the
      // installed @trigger.dev/python package's own .d.ts files, not just docs —
      // still worth one `npx trigger.dev@4.5.1 dev` run before deploying, since
      // that verifies the actual container build, not just the TS types.
      pythonExtension({
        requirementsFile: "./requirements.txt",
        scripts: ["agent/**/*.py"],
      }),
    ],
  },
});
