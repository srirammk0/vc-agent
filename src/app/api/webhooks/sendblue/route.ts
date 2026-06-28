import { tasks } from "@trigger.dev/sdk/v3";
import { chatReply } from "../../../../trigger/agent.js";
import { sendTypingIndicator } from "../../../../../lib/sendblue.js";

// Inbound iMessage from SendBlue. Configure this URL as the "receive" webhook
// in the SendBlue dashboard:  https://<your-app>/api/webhooks/sendblue
interface SendblueInbound {
  content?: string;
  is_outbound?: boolean;
  from_number?: string;
  number?: string;
}

function digits(n: string | undefined): string {
  return (n ?? "").replace(/\D/g, "");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SendblueInbound;

  // Ignore our own outbound messages echoed back.
  if (body.is_outbound) {
    return Response.json({ ok: true, action: "ignored", reason: "outbound" });
  }

  const message = body.content?.trim();
  if (!message) {
    return Response.json({ ok: true, action: "ignored", reason: "empty" });
  }

  // Only the owner may chat with the agent.
  const owner = digits(process.env.ALERT_PHONE_NUMBER);
  const sender = digits(body.from_number || body.number);
  if (owner && sender && !sender.endsWith(owner.slice(-10))) {
    return Response.json({ ok: true, action: "ignored", reason: "unauthorized sender" });
  }

  // Show the "…" bubble right away so the owner knows the agent is working.
  try {
    await sendTypingIndicator();
  } catch (err) {
    console.error("[sendblue-webhook] typing indicator failed:", err);
  }

  const handle = await tasks.trigger(chatReply.id, { message });
  console.log(`[sendblue-webhook] chat run ${handle.id}: ${message.slice(0, 60)}`);

  // Acknowledge fast; the reply is sent asynchronously by the task.
  return Response.json({ ok: true, runId: handle.id });
}
