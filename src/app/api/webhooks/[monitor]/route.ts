import { tasks } from "@trigger.dev/sdk/v3";
import { monitorWebhookHandler } from "../../../../trigger/monitor-webhook.js";

export async function POST(req: Request, { params }: { params: { monitor: string } }) {
  try {
    const body = await req.json();
    
    // Verify Parallel webhook signature (see Parallel docs)
    // const verified = verifyParallelSignature(req, body);
    
    const source = params.monitor; // "x-monitor" or "linkedin-monitor"
    
    // Fallback parsing just in case event schema varies
    const content = body?.data?.event?.output?.content || body?.content || "No content";
    const urls = body?.data?.event?.output?.urls || body?.urls || [];
    const timestamp = body?.data?.event?.event_date || new Date().toISOString();

    await tasks.trigger("monitor-webhook-handler", {
      source,
      content,
      urls,
      timestamp,
      raw: body,
    });

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[Webhook Error]", err);
    return new Response("Bad Request", { status: 400 });
  }
}
