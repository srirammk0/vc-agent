import type { Founder, Startup } from "../../lib/supabase";
import { hasEnrichmentData, isStaleRunning } from "../../lib/enrichment";
import FounderTimeline from "./FounderTimeline";
import { Pill, Dot } from "./ui/Pill";

type Props = {
  startup: Pick<Startup, "slug" | "enrichment_status" | "updated_at"> & EnrichmentFields;
};

type EnrichmentFields = Pick<
  Startup,
  | "company_description"
  | "founders"
  | "stage"
  | "raised"
  | "location"
  | "founded"
  | "team_size"
>;

const META_FIELDS: { key: keyof EnrichmentFields; label: string }[] = [
  { key: "stage",     label: "Stage"    },
  { key: "raised",    label: "Raised"   },
  { key: "location",  label: "Location" },
  { key: "founded",   label: "Founded"  },
  { key: "team_size", label: "Team"     },
];

/** Purely presentational — the parent owns the single live subscription and passes fresh data down. */
export default function EnrichmentSection({ startup: data }: Props) {
  const founders = (data.founders ?? []) as Founder[];
  const enriched = hasEnrichmentData(data);
  const metaItems = META_FIELDS.filter(({ key }) => data[key]);
  const stale = isStaleRunning(data);
  const isRunning = data.enrichment_status === "running" && !stale;
  const isFailed = data.enrichment_status === "failed" || stale;

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
      {/* Section header */}
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
          Enrichment
        </h2>
        {isRunning && (
          <span
            style={{
              fontSize: 11,
              color: "var(--accent)",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              className="live-dot"
              style={{ width: 5, height: 5, borderRadius: 999, background: "var(--accent)", flexShrink: 0 }}
            />
            enriching…
          </span>
        )}
        {enriched && !isRunning && (
          <Pill
            dot={false}
            style={{
              gap: 4,
              fontSize: 11,
              color: "var(--success)",
              background: "rgba(52,199,89,0.08)",
              border: "1px solid rgba(52,199,89,0.2)",
              padding: "2px 8px",
            }}
          >
            <Dot size={4} />
            enriched
          </Pill>
        )}
        {isFailed && !enriched && (
          <Pill
            dot={false}
            style={{
              gap: 4,
              fontSize: 11,
              color: "var(--warning, #f59e0b)",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.2)",
              padding: "2px 8px",
            }}
          >
            <Dot size={4} />
            {stale ? "stuck — retry" : "failed"}
          </Pill>
        )}
      </div>

      {isRunning ? (
        <p style={{ fontSize: 13, color: "var(--label)", margin: 0 }}>
          Fetching company and founder data…
        </p>
      ) : isFailed && !enriched ? (
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          {stale
            ? "This got stuck and never finished. Click Enrich to retry."
            : "Enrichment failed. Click Enrich to retry."}
        </p>
      ) : !enriched ? (
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          Not yet enriched. Click Enrich to fetch company and founder data.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Meta chips */}
          {metaItems.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                gap: 8,
              }}
            >
              {metaItems.map(({ key, label }) => (
                <div
                  key={key}
                  style={{
                    background: "var(--surface)",
                    borderRadius: 6,
                    padding: "10px 12px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 3,
                      fontWeight: 500,
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--body)", fontWeight: 500 }}>
                    {data[key] as string}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Company overview */}
          {data.company_description && (
            <div>
              <p
                style={{
                  fontSize: 10.5,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 6px",
                  fontWeight: 500,
                }}
              >
                Overview
              </p>
              <p style={{ fontSize: 13.5, lineHeight: "21px", color: "var(--body)", margin: 0 }}>
                {data.company_description}
              </p>
            </div>
          )}

          {/* Founders */}
          {founders.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 10.5,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 10px",
                  fontWeight: 500,
                }}
              >
                Founders
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {founders.map((f, i) => (
                  <FounderTimeline key={i} founder={f} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
