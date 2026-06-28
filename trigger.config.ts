import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_zkqctocaqceqitxjtbar",

  dirs: ["./src/trigger"],

  maxDuration: 300,

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
