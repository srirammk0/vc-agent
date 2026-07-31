import { schedules } from "@trigger.dev/sdk";
import { python } from "@trigger.dev/python";
import { parsePythonStdout } from "../lib/parsePythonStdout";

/**
 * Everyday morning wake-up (8:00 America/Los_Angeles).
 *
 * Deterministic cadence — not LLM-decided:
 *   1. This cron fires once each morning.
 *   2. agent/main.py mode="daily_morning" books today's remaining 5 sweeps at
 *      fixed PT hours (10, 12, 14, 16, 18) via Trigger.dev delayed triggers,
 *      then runs the morning sweep itself.
 *
 * Idempotency keys on the later sweeps mean a double-fire of this cron won't
 * duplicate the day's schedule.
 */
export const dailyMorningWakeup = schedules.task({
  id: "daily-morning-wakeup",
  maxDuration: 600,
  cron: {
    pattern: "0 8 * * *",
    timezone: "America/Los_Angeles",
    environments: ["PRODUCTION"],
  },
  run: async () => {
    const result = await python.runScript("agent/main.py", [
      JSON.stringify({ mode: "daily_morning" }),
    ]);
    return parsePythonStdout(result.stdout);
  },
});
