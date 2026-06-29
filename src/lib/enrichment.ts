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

export function hasEnrichmentData(startup: Partial<EnrichmentFields>): boolean {
  if (startup.company_description?.trim()) return true;
  if (startup.stage?.trim() || startup.raised?.trim() || startup.location?.trim()) {
    return true;
  }
  const founders = (startup.founders ?? []) as Founder[];
  return founders.some(
    (f) =>
      Boolean(f.name?.trim()) ||
      Boolean(f.background?.trim()) ||
      Boolean(f.linkedin?.trim())
  );
}

export function showEnrichButton(
  startup: Pick<Startup, "status" | "enrichment_status"> & Partial<EnrichmentFields>
): boolean {
  return (
    startup.status === "approved" &&
    startup.enrichment_status !== "running" &&
    !hasEnrichmentData(startup)
  );
}
