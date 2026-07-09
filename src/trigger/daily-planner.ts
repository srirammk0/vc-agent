import { schedules } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// New capability: each morning, agent/daily_planner.py decides which approved-but-quiet
// startups deserve a fresh look today and schedules each one via Trigger.dev (a real
// point-in-time trigger, not a poll). All the actual decision-making happens in
// Modal/Python — this task is just the clock that wakes it up.
export const dailyPlannerScheduled = schedules.task({
  id: "daily-planner-scheduled",
  cron: { pattern: "0 6 * * *", timezone: "America/New_York" },
  run: async () => callModal(process.env.MODAL_DAILY_PLANNER_URL),
});
