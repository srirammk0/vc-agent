import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  // TODO: Replace with your actual Trigger.dev project ref.
  // Find it at: https://cloud.trigger.dev → your project → Settings → Project ref
  // It looks like: "proj_xxxxxxxxxxxxxxxx"
  project: "proj_zkqctocaqceqitxjtbar",

  dirs: ["./src/trigger"],

  maxDuration: 300,

  build: {
    external: ["@composio/core"],
  },

  // Retry config (global defaults — can be overridden per task)
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
