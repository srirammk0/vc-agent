import { schedules } from "@trigger.dev/sdk";
import { runScheduledCheck } from "./run-scheduled-check";

// Once per week — one Fiber Agent run (max 10 companies). Credit-conscious complement
// to daily web sweeps; does not run Similarweb here.
export const fiberSourcingWeekly = schedules.task({
  id: "fiber-sourcing-weekly",
  cron: {
    pattern: "0 9 * * 1",
    timezone: "America/Los_Angeles",
  },
  run: async () => {
    await runScheduledCheck.trigger({ mode: "fiber_sourcing" });
    return { status: "triggered" };
  },
});
