/**
 * lib/queries.ts
 *
 * Rotating query bank for Exa company search.
 * Each run picks 2 queries using the current 1-hour epoch index.
 */

export const QUERY_BANK: string[] = [
  "early stage AI startup pre-seed seed under 20 employees 2024 2025 2026"
];

/**
 * Returns the single general query for the run.
 */
export function pickQueriesForRun(runIndex: number): string[] {
  return [QUERY_BANK[0]];
}

