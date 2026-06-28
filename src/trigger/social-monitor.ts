import { schedules } from "@trigger.dev/sdk/v3";
import { spawnSync } from "child_process";

// Runs every 4 hours — lighter, social signals only, no Firecrawl enrichment
export const socialMonitor = schedules.task({
  id: "social-monitor",
  cron: { pattern: "0 */4 * * *", timezone: "America/Los_Angeles" },
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const result = spawnSync("python3", ["agent/main.py"], {
      input: JSON.stringify({
        trigger: "social",
        timestamp: payload.timestamp.toISOString(),
      }),
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    if (result.status !== 0) {
      throw new Error(`Social monitor subprocess failed:\n${result.stderr}`);
    }

    return JSON.parse(result.stdout);
  },
});
