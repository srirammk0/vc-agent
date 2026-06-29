import type { Founder, Startup } from "./supabase";

export function hasEnrichmentData(
  startup: Pick<Startup, "company_description" | "founders">
): boolean {
  if (startup.company_description?.trim()) return true;
  const founders = (startup.founders ?? []) as Founder[];
  return founders.some(
    (f) =>
      Boolean(f.name?.trim()) ||
      Boolean(f.background?.trim()) ||
      Boolean(f.linkedin?.trim())
  );
}

export function showEnrichButton(
  startup: Pick<
    Startup,
    "status" | "enrichment_status" | "company_description" | "founders"
  >
): boolean {
  return (
    startup.status === "approved" &&
    startup.enrichment_status !== "running" &&
    !hasEnrichmentData(startup)
  );
}
