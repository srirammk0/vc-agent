import type { Competitor } from "../../lib/supabase";
import { formatVisits } from "../../lib/formatAnalytics";
import ProviderLogo from "./ProviderLogo";

export default function CompetitorsSection({ competitors }: { competitors: Competitor[] | null }) {
  const rows = (competitors ?? []).filter((c) => c.name || c.domain);
  if (rows.length === 0) return null;

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
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
          Competitors
        </h2>
        <ProviderLogo provider="similarweb" showLabel />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((c, i) => {
          const domain = (c.domain || "").trim();
          const href = domain
            ? domain.startsWith("http")
              ? domain
              : `https://${domain}`
            : null;
          return (
            <div
              key={`${c.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 0",
                borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ minWidth: 0 }}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "var(--heading)",
                      textDecoration: "none",
                    }}
                  >
                    {c.name || domain.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--heading)" }}>
                    {c.name || "—"}
                  </span>
                )}
                {domain && c.name && (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {domain.replace(/^https?:\/\//, "")}
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--label)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {formatVisits(c.monthly_visits ?? null)}/mo
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
