import { task } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// No schedule — this is the one-off delayed-trigger target. Modal's
// agent/trigger_client.py calls Trigger.dev's REST trigger endpoint for this
// task id with a `delay`, for both signal re-checks and text follow-ups
// (see agent/trigger_client.py, agent/signals_review.py, agent/agent.py).
export const runScheduledCheck = task({
  id: "run-scheduled-check",
  run: async (payload: Record<string, unknown>) =>
    callModal(process.env.MODAL_RUN_SCHEDULED_CHECK_URL, payload),
});
