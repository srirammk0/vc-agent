import type { Startup } from "./supabase";

const STATUS_ORDER: Record<Startup["status"], number> = {
  new: 0,
  approved: 1,
  call_booked: 2,
  passed: 3,
};

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** When the row was last meaningfully touched (ms) — updated_at first, since that's
 * what actually moves on a status change (approve/pass), not just the original save. */
function recencyMs(s: Startup): number {
  return (
    parseTime(s.updated_at) ||
    parseTime(s.created_at) ||
    parseTime(s.found_date) ||
    0
  );
}

/** All tab: new → approved → call booked → passed; within each group, most recently touched first
 * (so approving/passing a startup — or a batch action — bumps it to the top of its
 * new group). Ties (e.g. a bulk "Mark approved" stamps the same updated_at across
 * the whole selection) fall back to original creation recency, then slug purely for
 * deterministic ordering — never alphabetical as the actual sort criterion. */
export function sortStartups(list: Startup[]): Startup[] {
  return [...list].sort((a, b) => {
    const statusA = STATUS_ORDER[a.status] ?? 99;
    const statusB = STATUS_ORDER[b.status] ?? 99;
    if (statusA !== statusB) return statusA - statusB;

    const byRecency = recencyMs(b) - recencyMs(a);
    if (byRecency !== 0) return byRecency;

    const byCreated = parseTime(b.created_at) - parseTime(a.created_at);
    if (byCreated !== 0) return byCreated;

    return a.slug.localeCompare(b.slug);
  });
}
