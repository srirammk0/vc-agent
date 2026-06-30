import type { Startup } from "./supabase";

const STATUS_ORDER: Record<Startup["status"], number> = {
  new: 0,
  approved: 1,
  passed: 2,
};

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** When the row was added or last meaningfully changed (ms). */
function recencyMs(s: Startup): number {
  return (
    parseTime(s.created_at) ||
    parseTime(s.updated_at) ||
    parseTime(s.found_date) ||
    0
  );
}

/** All tab: new → approved → passed; within each group, newest Supabase row first. */
export function sortStartups(list: Startup[]): Startup[] {
  return [...list].sort((a, b) => {
    const statusA = STATUS_ORDER[a.status] ?? 99;
    const statusB = STATUS_ORDER[b.status] ?? 99;
    if (statusA !== statusB) return statusA - statusB;

    const byRecency = recencyMs(b) - recencyMs(a);
    if (byRecency !== 0) return byRecency;

    return a.slug.localeCompare(b.slug);
  });
}
