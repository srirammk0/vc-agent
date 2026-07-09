import { schedules } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// Daily signals_review_agent curates the day's raw signals — whatever landed in the
// `signals` table via agent-directed crawls (agent/agent.py's crawl_for_startups tool)
// since the last review. Was modal.Cron("50 23 * * *", timezone="America/New_York")
// in modal_app.py before the Trigger.dev migration.
export const signalsReviewScheduled = schedules.task({
  id: "signals-review-scheduled",
  cron: { pattern: "50 23 * * *", timezone: "America/New_York" },
  run: async () => callModal(process.env.MODAL_SIGNALS_REVIEW_URL),
});
