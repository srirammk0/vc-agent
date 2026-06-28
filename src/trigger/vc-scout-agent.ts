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

// Scheduled: 8am, 12pm, 6pm PT daily
export const vcScoutScheduled = schedules.task({
  id: "vc-scout-scheduled",
  cron: { pattern: "0 8,12,18 * * *", timezone: "America/Los_Angeles" },
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return runScout({ trigger: "scheduled", timestamp: payload.timestamp.toISOString() });
  },
});

// On-demand: called from Next.js API route or Firecrawl webhook
export const vcScoutOnDemand = task({
  id: "vc-scout-on-demand",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async (payload: {
    trigger: "manual" | "firecrawl_monitor";
    note?: string;
    monitor_context?: { monitor_name: string; url: string; monitor_id: string };
  }) => {
    return runScout(payload);
  },
});

async function runScout(payload: object): Promise<AgentResult> {
  const result = spawnSync(
    "python3",
    [path.join(process.cwd(), "agent/main.py")],
    {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      timeout: 180_000,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    }
  );

  if (result.status !== 0) {
    throw new Error(`Agent subprocess failed:\n${result.stderr}`);
  }

  const summary: AgentResult = JSON.parse(result.stdout);

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
}
