import { schedules } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// Mirrors Supermemory -> Supabase. Every real write path (chat replies, feedback
// submits) already spawns an on-demand sync immediately after the write, so this
// cron is just a drift safety net, not the primary sync mechanism — a low-frequency
// backstop is enough, not */30 (48 full-table-scan runs/day for something already
// covered by direct triggers almost every time).
export const syncScheduled = schedules.task({
  id: "sync-scheduled",
  cron: "0 */4 * * *",
  run: async () => callModal(process.env.MODAL_SYNC_URL),
});
