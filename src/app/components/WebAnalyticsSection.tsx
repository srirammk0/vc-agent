import type { FiberMeta, Startup, WebAnalytics } from "../../lib/supabase";
import { formatGrowthPct, formatRank, formatVisits } from "../../lib/formatAnalytics";
import ProviderLogo from "./ProviderLogo";

type Props = {
  monthlyVisits: Startup["monthly_visits"];
  globalRank: Startup["global_rank"];
  webAnalytics: WebAnalytics | null;
  fiberMeta: FiberMeta | null;
};

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: 8,
        padding: "12px 14px",
        border: "1px solid var(--border)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 650, color: "var(--heading)", letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  );
}

export default function WebAnalyticsSection({
  monthlyVisits,
  globalRank,
  webAnalytics,
  fiberMeta,
}: Props) {
  const visits = monthlyVisits ?? webAnalytics?.monthly_visits;
  const rank = globalRank ?? webAnalytics?.global_rank;
  const growth = webAnalytics?.visit_growth_pct;
  const employees = fiberMeta?.employee_count;
  const companyLinkedin = fiberMeta?.company_linkedin;

  const hasTraffic = visits != null && visits > 0;
  const hasRank = rank != null && rank > 0;
  const hasGrowth = growth != null;
  const hasFiber = employees != null || companyLinkedin;

  if (!hasTraffic && !hasRank && !hasGrowth && !hasFiber) {
    return null;
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "20px 22px",
        marginBottom: 14,
        background: "var(--card-bg)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(255,255,255,0.6) inset",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--label)",
            margin: 0,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          Web & company intel
        </h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {(hasTraffic || hasRank || hasGrowth) && <ProviderLogo provider="similarweb" showLabel />}
          {hasFiber && <ProviderLogo provider="fiber" showLabel />}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 8,
          marginBottom: companyLinkedin ? 12 : 0,
        }}
      >
        {hasTraffic && <StatCell label="Monthly visits" value={formatVisits(visits)} />}
        {hasRank && <StatCell label="Global rank" value={formatRank(rank)} />}
        {hasGrowth && <StatCell label="Traffic growth" value={formatGrowthPct(growth)} />}
        {employees != null && <StatCell label="Employees" value={String(employees)} />}
      </div>

      {companyLinkedin && (
        <a
          href={
            companyLinkedin.startsWith("http") ? companyLinkedin : `https://${companyLinkedin}`
          }
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}
        >
          Company LinkedIn →
        </a>
      )}
    </div>
  );
}

export function VisitsChip({ visits }: { visits: number | null | undefined }) {
  if (visits == null || visits <= 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        fontWeight: 500,
        color: "var(--label)",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "2px 7px",
      }}
    >
      <ProviderLogo provider="similarweb" size={12} />
      {formatVisits(visits)}/mo
    </span>
  );
}

export function EmailChip({ hasEmail }: { hasEmail: boolean }) {
  if (!hasEmail) return null;
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 500,
        color: "var(--success)",
        background: "rgba(52,199,89,0.08)",
        border: "1px solid rgba(52,199,89,0.2)",
        borderRadius: 4,
        padding: "2px 7px",
      }}
    >
      email
    </span>
  );
}
