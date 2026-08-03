/** Format large visit counts for list chips and analytics cards. */
export function formatVisits(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatGrowthPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

export function formatRank(rank: number | null | undefined): string {
  if (rank == null || rank <= 0) return "—";
  if (rank >= 1_000_000) return `#${(rank / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (rank >= 1_000) return `#${(rank / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `#${rank}`;
}

export function visitsTier(n: number | null | undefined): "hot" | "mid" | "low" | "none" {
  if (n == null || n <= 0) return "none";
  if (n >= 50_000) return "hot";
  if (n >= 5_000) return "mid";
  return "low";
}
