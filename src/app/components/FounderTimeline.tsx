import { ExternalLink, Sparkles } from "lucide-react";
import type { Founder, FounderPosition } from "../../lib/supabase";

function dateRange(p: FounderPosition): string {
  const start = p.start_date?.trim();
  const end = p.is_current ? "Present" : p.end_date?.trim();
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end) return end;
  return "";
}

function sortedPositions(positions: FounderPosition[]): FounderPosition[] {
  return [...positions].sort((a, b) => {
    if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
    // Best-effort recency sort on whatever end/start year is present — the backend
    // already writes these most-recent-first, this just guards against a future
    // change (or hand-edited data) not maintaining that order.
    const ay = parseInt((a.end_date || a.start_date || "").slice(-4), 10) || 0;
    const by = parseInt((b.end_date || b.start_date || "").slice(-4), 10) || 0;
    return by - ay;
  });
}

/** One founder's LinkedIn-style career timeline plus a one-line credibility read —
 * the "are they cracked, and what's the proof" signal, especially for stealth
 * startups that have nothing else public to judge yet. */
export default function FounderTimeline({ founder: f }: { founder: Founder }) {
  const positions = sortedPositions(f.positions ?? []);
  const hasTimeline = positions.length > 0;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "16px 18px",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 650, color: "var(--heading)", letterSpacing: "-0.1px" }}>
          {f.name || "Unknown"}
        </span>
        {f.linkedin && (
          <a
            href={f.linkedin.startsWith("http://") || f.linkedin.startsWith("https://") ? f.linkedin : `https://${f.linkedin}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--accent)",
              textDecoration: "none",
              whiteSpace: "nowrap",
              opacity: 0.85,
              flexShrink: 0,
            }}
          >
            LinkedIn
            <ExternalLink size={11} strokeWidth={2.2} />
          </a>
        )}
      </div>

      {f.credibility_note && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: 6,
          }}
        >
          <Sparkles size={12} strokeWidth={2.2} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 12.5, lineHeight: "18px", color: "var(--body)", fontStyle: "italic", margin: 0 }}>
            {f.credibility_note}
          </p>
        </div>
      )}

      {f.background && !hasTimeline && (
        <p style={{ fontSize: 13, lineHeight: "20px", color: "var(--label)", margin: "10px 0 0" }}>
          {f.background}
        </p>
      )}

      {hasTimeline && (
        <div style={{ position: "relative", marginTop: 14 }}>
          {/* One continuous rail behind every dot, instead of per-segment lines —
              only when there's more than one position to actually connect. */}
          {positions.length > 1 && (
            <div
              style={{
                position: "absolute",
                left: 3.5,
                top: 6,
                bottom: 6,
                width: 1.5,
                background: "var(--border)",
              }}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {positions.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 12, position: "relative" }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: p.is_current ? "var(--accent)" : "var(--card-bg)",
                    border: p.is_current ? "none" : "1.5px solid var(--border-med)",
                    boxShadow: p.is_current ? "0 0 0 3px rgba(0,122,255,0.15)" : "none",
                    marginTop: 4,
                    flexShrink: 0,
                    zIndex: 1,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--heading)" }}>
                      {p.title}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>·</span>
                    <span style={{ fontSize: 12.5, color: "var(--label)" }}>
                      {p.company}
                    </span>
                  </div>
                  {dateRange(p) && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                      {dateRange(p)}
                    </div>
                  )}
                  {p.description && (
                    <p style={{ fontSize: 12.5, lineHeight: "19px", color: "var(--label)", margin: "4px 0 0" }}>
                      {p.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
