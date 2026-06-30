"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Founder, Startup } from "../../lib/supabase";
import { hasEnrichmentData } from "../../lib/enrichment";
import { getBrowserClient } from "../../lib/supabaseBrowser";

type Props = {
  startup: Pick<Startup, "slug" | "enrichment_status"> & EnrichmentFields;
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

export default function EnrichmentSection({ startup }: Props) {
  const router = useRouter();
  const [data, setData] = useState(startup);

  useEffect(() => { setData(startup); }, [startup]);

  useEffect(() => {
    const client = getBrowserClient();
    if (!client) return;
    const channel = client
      .channel(`startup-${startup.slug}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "startups", filter: `slug=eq.${startup.slug}` },
        (payload) => { setData((prev) => ({ ...prev, ...(payload.new as Partial<Startup>) })); }
      )
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [startup.slug]);

  useEffect(() => {
    if (getBrowserClient()) return;
    if (data.enrichment_status !== "running") return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/startup/${data.slug}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.enrichment_status !== "running") {
          setData((prev) => ({ ...prev, ...json }));
          router.refresh();
        }
      } catch { /* ignore */ }
    };
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [data.slug, data.enrichment_status, router]);

  const founders = (data.founders ?? []) as Founder[];
  const enriched = hasEnrichmentData(data);
  const metaItems = META_FIELDS.filter(({ key }) => data[key]);
  const isRunning = data.enrichment_status === "running";

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
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
              color: "var(--success)",
              background: "rgba(52,199,89,0.08)",
              border: "1px solid rgba(52,199,89,0.2)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            <span style={{ width: 4, height: 4, borderRadius: 999, background: "var(--success)", flexShrink: 0 }} />
            enriched
          </span>
        )}
      </div>

      {isRunning ? (
        <p style={{ fontSize: 13, color: "var(--label)", margin: 0 }}>
          Fetching company and founder data…
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
                  <div
                    key={i}
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
                        marginBottom: f.background ? 6 : 0,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--heading)" }}>
                        {f.name || "Unknown"}
                      </span>
                      {f.linkedin && (
                        <a
                          href={f.linkedin}
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
                    {f.background && (
                      <p style={{ fontSize: 13, lineHeight: "20px", color: "var(--label)", margin: 0 }}>
                        {f.background}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
