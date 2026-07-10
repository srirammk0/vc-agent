import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev's only job in this project is scheduling: every task here is a
// thin fetch() forwarding call into a Modal HTTP endpoint at the right time
// (fixed cron or a one-off delayed trigger). All agentic work — LLM calls,
// Supermemory/Supabase writes, SMS — stays on Modal.
// See README.md "Scheduling (Trigger.dev)" and modal_app.py.
export default defineConfig({
  project: "proj_zkqctocaqceqitxjtbar",

  dirs: ["./src/trigger"],

  maxDuration: 60,

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
});
