import { task } from "@trigger.dev/sdk";
import { callModal } from "./lib/modal";

// No schedule — this is the one-off delayed-trigger target. Modal's
// agent/trigger_client.py calls Trigger.dev's REST trigger endpoint for this
// task id with a `delay`, for follow-ups and self-scheduled checks
// (see agent/trigger_client.py, agent/agent.py).
export const runScheduledCheck = task({
  id: "run-scheduled-check",
  run: async (payload: Record<string, unknown>) =>
    callModal(process.env.MODAL_RUN_SCHEDULED_CHECK_URL, payload),
});
