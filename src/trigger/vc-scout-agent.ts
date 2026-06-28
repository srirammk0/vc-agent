import { task, schedules } from "@trigger.dev/sdk/v3";
import { spawnSync } from "child_process";
import path from "path";
import { sendAlert } from "../../lib/sendblue.js";

interface HighSignalDetail {
  name: string;
  slug: string;
  score: number;
  one_liner: string;
  website: string;
  founder_linkedin: string;
}

export interface AgentResult {
  trigger: string;
  timestamp: string;
  duration_seconds: number;
  queries_run: number;
  pages_enriched: number;
  startups_found: number;
  startups_updated: number;
  alerts_sent: number;
  skipped_known: number;
  new_startups: string[];
  high_signal: string[];
  high_signal_details: HighSignalDetail[];
}

export interface MonitorContext {
  monitor_id: string;
  monitor_name: string;
  url: string;
}

export interface VcScoutPayload {
  trigger: "manual" | "cron" | "firecrawl_monitor";
  timestamp?: string;
  note?: string;
  monitor_context?: MonitorContext;
}

// The single VC scout agent. Triggered three ways:
//   - manually   (Next.js "run now" button → /api/trigger)
//   - on a cron  (vcScoutCron below)
//   - by webhook (Firecrawl monitors → /api/webhooks/firecrawl)
export const vcScout = task({
  id: "vc-scout",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async (payload: VcScoutPayload): Promise<AgentResult> => {
    const summary = runAgent(payload);

    for (const detail of summary.high_signal_details ?? []) {
      try {
        await sendAlert({
          name: detail.name,
          score: detail.score,
          oneLiner: detail.one_liner,
          website: detail.website,
          founderLinkedin: detail.founder_linkedin,
        });
        console.log(`[sendblue] Alert sent: ${detail.name}`);
      } catch (err) {
        console.error(`[sendblue] Failed for ${detail.name}:`, err);
      }
    }

    return summary;
  },
});

// Cron source — just fires the scout. Keeps the agent itself a single general task.
export const vcScoutCron = schedules.task({
  id: "vc-scout-cron",
  cron: { pattern: "0 */4 * * *", timezone: "America/Los_Angeles" },
  run: async (payload) => {
    await vcScout.trigger({
      trigger: "cron",
      timestamp: payload.timestamp.toISOString(),
    });
  },
});

function runAgent(payload: VcScoutPayload): AgentResult {
  const result = spawnSync(
    "python3",
    [path.join(process.cwd(), "agent/main.py")],
    {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      timeout: 240_000,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    }
  );

  if (result.status !== 0) {
    throw new Error(`Agent subprocess failed:\n${result.stderr}`);
  }

  return JSON.parse(result.stdout) as AgentResult;
}
