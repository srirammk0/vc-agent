import { defineConfig } from "@trigger.dev/sdk";
import { pythonExtension } from "@trigger.dev/python/extension";

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
