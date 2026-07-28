import type { Founder, Startup } from "./supabase";

type EnrichmentFields = Pick<
  Startup,
  | "company_description"
  | "founders"
  | "stage"
  | "raised"
  | "location"
  | "founded"
  | "team_size"
>;

export function hasEnrichmentData(
  startup: Partial<EnrichmentFields> & { enriched?: boolean }
): boolean {
  // List rows carry only this flag — they don't fetch the enrichment columns at all
  // (see STARTUP_LIST_COLUMNS). Detail rows carry both, and the field checks below
  // still decide for them, so a row enriched before this column existed and never
  // backfilled still reads correctly once it's opened.
  if (startup.enriched) return true;
  if (startup.company_description?.trim()) return true;
  if (startup.stage?.trim() || startup.raised?.trim() || startup.location?.trim()) {
    return true;
  }
  const founders = (startup.founders ?? []) as Founder[];
  // A name/background/linkedin alone can come from a bare save (e.g. a stealth
  // candidate saved with just what the sweep already knew) — that's not enrichment.
  // Only real researched career history counts.
  return founders.some((f) => Boolean(f.positions && f.positions.length > 0));
}

// Comfortably above the Trigger.dev task's own 600s maxDuration (trigger.config.ts)
// running agent/enrich_job.py, plus queueing slack — a row still "running" past
// this is stuck (the task was killed/crashed before it could reset
// enrichment_status), not genuinely in progress, so it should be treated as
// retryable rather than perpetually busy.
const STALE_RUNNING_MS = 10 * 60 * 1000;

export function isStaleRunning(
  startup: Pick<Startup, "enrichment_status" | "updated_at">
): boolean {
  if (startup.enrichment_status !== "running") return false;
  if (!startup.updated_at) return false;
  return Date.now() - new Date(startup.updated_at).getTime() > STALE_RUNNING_MS;
}

export function showEnrichButton(
  startup: Pick<Startup, "status" | "enrichment_status" | "updated_at"> &
    Partial<EnrichmentFields> & { enriched?: boolean }
): boolean {
  if (
    startup.status !== "approved" &&
    startup.status !== "responded" &&
    startup.status !== "call_booked"
  )
    return false;
  if (hasEnrichmentData(startup)) return false;
  if (startup.enrichment_status === "failed") return true;
  if (startup.enrichment_status === "running") return isStaleRunning(startup);
  return true;
}
