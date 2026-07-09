import { schedules } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// LinkedIn/X signal scrape + Gemma filter. Was modal.Cron("0 */2 * * *") in modal_app.py.
export const signalsScrapeScheduled = schedules.task({
  id: "signals-scrape-scheduled",
  cron: "0 */2 * * *",
  run: async () => callModal(process.env.MODAL_SIGNALS_SCRAPE_URL),
});
