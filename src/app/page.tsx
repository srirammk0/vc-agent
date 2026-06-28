import { loadBrain, type Startup, type RunRecord } from "../../lib/blob.js";

export const revalidate = 300;

// ─── helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(mins)) return "unknown";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scoreColor(score: number): string {
  if (score >= 75) return "#b94f1c";
  if (score >= 60) return "#2a6db5";
  return "#555555";
}

const STATUS_BADGE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  interested: { bg: "#fff7ed", border: "#ffedd5", text: "#ea580c",  label: "Interested" },
  reviewing:  { bg: "#eff6ff", border: "#bfdbfe", text: "#3b82f6",  label: "Reviewing"  },
  passed:     { bg: "#ecfdf5", border: "#a7f3d0", text: "#10b981",  label: "Passed"     },
  pitched:    { bg: "#faf5ff", border: "#d8b4fe", text: "#9333ea",  label: "Pitched"    },
  failed:     { bg: "#fef2f2", border: "#fca5a5", text: "#ef4444",  label: "Failed"     },
  new:        { bg: "#f4f4f0", border: "#d4d4d0", text: "#888888",  label: "New"        },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.new;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: "10px",
        fontWeight: 500,
        letterSpacing: "0.04em",
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: "4px",
        color: s.text,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function Home() {
  const brain = await loadBrain();
  const startups: Startup[] = Object.values(brain.startups).sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );
  const runs: RunRecord[] = [...brain.runs].reverse();
  const hotCount = startups.filter((s) => s.score >= 75).length;

  const PAGE: React.CSSProperties = {
    minHeight: "100vh",
    background: "#f4f4f0",
    padding: "48px 24px 80px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    WebkitFontSmoothing: "antialiased",
  };

  const CONTAINER: React.CSSProperties = {
    maxWidth: "840px",
    margin: "0 auto",
  };

  const CARD: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #ebebeb",
    borderRadius: "8px",
    overflow: "hidden",
  };

  const LABEL: React.CSSProperties = {
    fontSize: "9px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#aaaaaa",
  };

  return (
    <div style={PAGE}>
      <div style={CONTAINER}>

        {/* ── Header ── */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ ...LABEL, marginBottom: "10px" }}>
                Auto-generated · VC Research Agent
              </div>
              <h1
                style={{
                  fontSize: "28px",
                  fontWeight: 600,
                  color: "#111111",
                  margin: "0 0 6px",
                  lineHeight: 1.15,
                  letterSpacing: "-0.01em",
                }}
              >
                Startup Pipeline
              </h1>
              <p style={{ fontSize: "13px", color: "#666666", margin: 0 }}>
                {startups.length} companies discovered
                {hotCount > 0 && (
                  <> · <span style={{ color: "#b94f1c" }}>{hotCount} hot</span></>
                )}
              </p>
            </div>
            <div style={{ textAlign: "right", paddingTop: "2px" }}>
              <div style={{ ...LABEL, marginBottom: "5px" }}>Last updated</div>
              <div style={{ fontSize: "13px", color: "#666666" }}>
                {timeAgo(brain.updated)}
              </div>
            </div>
          </div>
        </div>

        {/* ── Startup table ── */}
        {startups.length > 0 ? (
          <div style={{ ...CARD, marginBottom: "32px" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr>
                  {(["Company", "Score", "Status", "Stage", "Raised", "Found"] as const).map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          ...LABEL,
                          padding: "10px 16px",
                          textAlign: "left",
                          borderBottom: "1px solid #ebebeb",
                          fontWeight: 500,
                          background: "#fafafa",
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {startups.map((s, i) => (
                  <tr
                    key={s.slug}
                    style={{
                      borderBottom: i < startups.length - 1 ? "1px solid #ebebeb" : "none",
                    }}
                  >
                    {/* Company name + one-liner */}
                    <td style={{ padding: "14px 16px", verticalAlign: "middle", minWidth: "220px" }}>
                      {s.website ? (
                        <a
                          href={s.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#111111",
                            textDecoration: "none",
                            display: "block",
                            lineHeight: 1.3,
                          }}
                        >
                          {s.name}
                        </a>
                      ) : (
                        <span
                          style={{
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#111111",
                            display: "block",
                            lineHeight: 1.3,
                          }}
                        >
                          {s.name}
                        </span>
                      )}
                      {s.one_liner && (
                        <span
                          style={{
                            fontSize: "12px",
                            color: "#666666",
                            display: "block",
                            marginTop: "2px",
                            lineHeight: 1.4,
                          }}
                        >
                          {s.one_liner}
                        </span>
                      )}
                    </td>

                    {/* Score */}
                    <td style={{ padding: "14px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          fontSize: "18px",
                          fontWeight: 700,
                          color: scoreColor(s.score ?? 0),
                          fontVariantNumeric: "tabular-nums",
                          lineHeight: 1,
                        }}
                      >
                        {s.score ?? "—"}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={{ padding: "14px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                      <StatusBadge status={s.status ?? "new"} />
                    </td>

                    {/* Stage */}
                    <td
                      style={{
                        padding: "14px 16px",
                        verticalAlign: "middle",
                        color: s.stage ? "#555555" : "#cccccc",
                        fontSize: "13px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.stage || "—"}
                    </td>

                    {/* Raised */}
                    <td
                      style={{
                        padding: "14px 16px",
                        verticalAlign: "middle",
                        color: s.raised ? "#555555" : "#cccccc",
                        fontSize: "13px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.raised || "—"}
                    </td>

                    {/* Found date */}
                    <td
                      style={{
                        padding: "14px 16px",
                        verticalAlign: "middle",
                        color: "#aaaaaa",
                        fontSize: "12px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtDate(s.found)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            style={{
              ...CARD,
              padding: "64px 32px",
              textAlign: "center",
              marginBottom: "32px",
            }}
          >
            <p style={{ fontSize: "14px", color: "#666666", margin: "0 0 6px" }}>
              No startups in brain yet.
            </p>
            <p style={{ fontSize: "12px", color: "#aaaaaa", margin: 0 }}>
              The next 4-hour sweep will populate this.
            </p>
          </div>
        )}

        {/* ── Recent sweeps ── */}
        {runs.length > 0 && (
          <div style={{ marginBottom: "32px" }}>
            <div style={{ ...LABEL, marginBottom: "14px" }}>Recent sweeps</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {runs.slice(0, 6).map((r, i) => (
                <div key={`${r.ts}-${i}`} style={{ ...CARD, padding: "16px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "8px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ ...LABEL }}>{r.trigger}</span>
                      {r.found > 0 && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 500,
                            color: "#10b981",
                            background: "#ecfdf5",
                            border: "1px solid #a7f3d0",
                            borderRadius: "4px",
                            padding: "1px 7px",
                          }}
                        >
                          +{r.found} found
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "11px", color: "#aaaaaa" }}>{timeAgo(r.ts)}</span>
                  </div>
                  <div style={{ height: "1px", background: "#f4f4f0", marginBottom: "10px" }} />
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#555555",
                      margin: 0,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {r.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        {brain.notes.length > 0 && (
          <div style={{ marginBottom: "32px" }}>
            <div style={{ ...LABEL, marginBottom: "14px" }}>Agent notes</div>
            <div style={{ ...CARD, padding: "16px 20px" }}>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {brain.notes.map((note, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: "12px",
                      color: "#555555",
                      lineHeight: 1.6,
                      padding: "6px 0",
                      borderBottom: i < brain.notes.length - 1 ? "1px solid #f4f4f0" : "none",
                    }}
                  >
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div
          style={{
            display: "flex",
            gap: "20px",
            alignItems: "center",
            ...LABEL,
            paddingTop: "8px",
          }}
        >
          <span>Auto sweep · every 4h PT</span>
          <span style={{ color: "#d4d4d0" }}>·</span>
          <a
            href="https://cloud.trigger.dev"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#aaaaaa", textDecoration: "none" }}
          >
            Trigger.dev
          </a>
          <span style={{ color: "#d4d4d0" }}>·</span>
          <a
            href="https://logfire.pydantic.dev"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#aaaaaa", textDecoration: "none" }}
          >
            Logfire
          </a>
        </div>

      </div>
    </div>
  );
}
