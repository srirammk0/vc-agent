import { schedules } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// Daily signals_review_agent curates the day's raw signals. Was
// modal.Cron("50 23 * * *", timezone="America/New_York") in modal_app.py — runs
// after that day's last signals-scrape-scheduled fire (last 2h fire is 22:00 UTC).
export const signalsReviewScheduled = schedules.task({
  id: "signals-review-scheduled",
  cron: { pattern: "50 23 * * *", timezone: "America/New_York" },
  run: async () => callModal(process.env.MODAL_SIGNALS_REVIEW_URL),
});
