import { tasks } from "@trigger.dev/sdk/v3";
import { vcScout } from "../../../../trigger/vc-scout-agent.js";

// Firecrawl sends this for each completed monitor check
interface FirecrawlWebhookPayload {
  type: "monitor.page" | "monitor.check.completed";
  data: Array<{
    monitorId: string;
    checkId: string;
    url?: string;
    status?: "same" | "new" | "changed" | "removed" | "error";
    isMeaningful?: boolean;
    summary?: {
      totalPages: number;
      same: number;
      changed: number;
      new: number;
      removed: number;
      error: number;
    };
  }>;
}

// Optional map of monitor id → human-readable name, supplied via env as JSON
function getMonitorNames(): Record<string, string> {
  const raw = process.env.FIRECRAWL_MONITOR_IDS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-firecrawl-secret");
  if (
    process.env.FIRECRAWL_WEBHOOK_SECRET &&
    secret !== process.env.FIRECRAWL_WEBHOOK_SECRET
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: FirecrawlWebhookPayload = await req.json();

  if (body.type !== "monitor.check.completed") {
    return Response.json({ ok: true, action: "ignored", reason: "not a completed check" });
  }

  const check = body.data?.[0];
  if (!check) return Response.json({ ok: true, action: "ignored", reason: "empty data" });

  const { changed = 0, new: newPages = 0 } = check.summary ?? {};
  if (changed === 0 && newPages === 0) {
    return Response.json({ ok: true, action: "ignored", reason: "no changes" });
  }

  const monitorName = getMonitorNames()[check.monitorId] ?? check.monitorId;

  const handle = await tasks.trigger(vcScout.id, {
    trigger: "firecrawl_monitor",
    monitor_context: {
      monitor_id: check.monitorId,
      monitor_name: monitorName,
      url: check.url ?? "unknown",
    },
  });

  console.log(`[firecrawl-webhook] Triggered scout run ${handle.id} for monitor ${monitorName}`);
  return Response.json({ ok: true, runId: handle.id, monitor: monitorName });
}
