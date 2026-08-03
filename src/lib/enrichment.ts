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
  startup: Partial<EnrichmentFields> & { enriched?: boolean; has_email?: boolean }
): boolean {
  // List rows carry only denormalized flags — they don't fetch founders /
  // company_description (see STARTUP_LIST_COLUMNS). Detail rows carry both.
  // A startup is only fully enriched once at least one founder email exists.
  const founders = (startup.founders ?? []) as Founder[];
  const hasEmail =
    startup.has_email === true ||
    founders.some((f) => Boolean(f.email?.trim()));
  if (!hasEmail) return false;
  if (startup.enriched) return true;
  if (startup.company_description?.trim()) return true;
  if (startup.stage?.trim() || startup.raised?.trim() || startup.location?.trim()) {
    return true;
  }
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
    Partial<EnrichmentFields> & { enriched?: boolean; has_email?: boolean }
): boolean {
  if (
    startup.status !== "approved" &&
    startup.status !== "responded" &&
    startup.status !== "call_booked"
  )
    return false;
  // Email enrichment is the actionable completion signal for the dashboard. Once
  // a founder email exists, don't keep offering the same enrichment action even
  // if other optional enrichment fields are still missing.
  const founders = (startup.founders ?? []) as Founder[];
  const hasEmail = startup.has_email ?? founders.some((f) => Boolean(f.email?.trim()));
  if (hasEmail) return false;
  if (hasEnrichmentData(startup)) return false;
  if (startup.enrichment_status === "failed") return true;
  if (startup.enrichment_status === "running") return isStaleRunning(startup);
  return true;
}
