import { tasks } from "@trigger.dev/sdk/v3";
import { researchSweep } from "../../../trigger/agent.js";

// "Run now" button — kicks off an on-demand research sweep.
export async function POST() {
  const handle = await tasks.trigger(researchSweep.id, {});
  return Response.json({ runId: handle.id });
}
