import type { Startup } from "./supabase";

const STATUS_ORDER: Record<Startup["status"], number> = {
  new: 0,
  approved: 1,
  passed: 2,
};

/** new → approved → passed, then newest found_date first within each group */
export function sortStartups(list: Startup[]): Startup[] {
  return [...list].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return (b.found_date ?? "").localeCompare(a.found_date ?? "");
  });
}
