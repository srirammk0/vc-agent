import { tasks } from "@trigger.dev/sdk/v3";
import { vcScout } from "../../../trigger/vc-scout-agent.js";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const handle = await tasks.trigger(vcScout.id, {
    trigger: "manual",
    note: body.note,
  });

  return Response.json({ runId: handle.id });
}
