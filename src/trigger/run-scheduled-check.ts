import { task } from "@trigger.dev/sdk";
import { python } from "@trigger.dev/python";
import { parsePythonStdout } from "../lib/parsePythonStdout";

// The one Trigger.dev task for every piece of agent work that isn't live web chat
// (api/chat.py on Vercel handles that directly, unchanged — no Trigger.dev
// involved). Triggered two ways:
//   - Immediately, from a dashboard route (src/app/api/enrich, /api/feedback)
//     via `.trigger({mode: "enrich" | "feedback", ...})`
//   - On a delay, via Trigger.dev's REST trigger endpoint (agent/trigger_client.py
//     schedule_check, called by the schedule_agent_run tool) with
//     `{mode: "scheduled_check", kind: "agent_followup", instructions, ...}`
// Every payload shape is whatever agent/agent.py's run_agent() dispatches on by
// "mode" — this task is a thin shell around python.runScript, not separate logic
// per job.
//
// Kept as "run-scheduled-check" (not renamed to something more general) because
// agent/trigger_client.py's REST calls hardcode this task id as the delayed-trigger
// target — renaming it would mean updating that URL for no functional benefit.
export const runScheduledCheck = task({
  id: "run-scheduled-check",
  maxDuration: 600,
  run: async (payload: Record<string, unknown>) => {
    const result = await python.runScript("agent/main.py", [JSON.stringify(payload)]);
    return parsePythonStdout(result.stdout);
  },
});
