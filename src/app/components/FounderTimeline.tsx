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

/** One founder's LinkedIn-style career timeline plus a grounded credibility read —
 * the "are they cracked, and what's the proof" signal, especially for stealth
 * startups that have nothing else public to judge yet. */
export default function FounderTimeline({ founder: f }: { founder: Founder }) {
  const positions = sortedPositions(f.positions ?? []);
  const hasTimeline = positions.length > 0;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: f.background || hasTimeline || f.credibility_note ? 8 : 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--heading)" }}>
          {f.name || "Unknown"}
        </span>
        {f.linkedin && (
          <a
            href={f.linkedin.startsWith("http://") || f.linkedin.startsWith("https://") ? f.linkedin : `https://${f.linkedin}`}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 12,
              color: "var(--accent)",
              textDecoration: "none",
              whiteSpace: "nowrap",
              opacity: 0.8,
            }}
          >
            LinkedIn →
          </a>
        )}
      </div>

      {f.background && !hasTimeline && (
        <p style={{ fontSize: 13, lineHeight: "20px", color: "var(--label)", margin: 0 }}>
          {f.background}
        </p>
      )}

      {f.credibility_note && (
        <div
          style={{
            borderLeft: "2.5px solid var(--accent)",
            background: "rgba(0,122,255,0.05)",
            borderRadius: "0 6px 6px 0",
            padding: "8px 12px",
            marginTop: hasTimeline || f.background ? 10 : 0,
            marginBottom: hasTimeline ? 14 : 0,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--accent)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Credibility read
          </div>
          <p style={{ fontSize: 12.5, lineHeight: "19px", color: "var(--body)", margin: 0 }}>
            {f.credibility_note}
          </p>
        </div>
      )}

      {hasTimeline && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {positions.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              {/* Rail: dot + connecting line, LinkedIn-experience style */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 10, flexShrink: 0 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: p.is_current ? "var(--accent)" : "var(--border-med)",
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                />
                {i < positions.length - 1 && (
                  <span style={{ flex: 1, width: 1.5, background: "var(--border)", marginTop: 2 }} />
                )}
              </div>
              <div style={{ paddingBottom: i < positions.length - 1 ? 14 : 0, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--heading)" }}>
                    {p.title}
                  </span>
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
      )}
    </div>
  );
}
