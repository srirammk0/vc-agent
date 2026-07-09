import { schedules } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// Mirrors Supermemory -> Supabase. Was modal.Cron("*/30 * * * *") in modal_app.py.
export const syncScheduled = schedules.task({
  id: "sync-scheduled",
  cron: "*/30 * * * *",
  run: async () => callModal(process.env.MODAL_SYNC_URL),
});
