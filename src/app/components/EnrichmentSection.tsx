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
  { key: "stage", label: "Stage" },
  { key: "raised", label: "Raised" },
  { key: "location", label: "Location" },
  { key: "founded", label: "Founded" },
  { key: "team_size", label: "Team" },
];

export default function EnrichmentSection({ startup }: Props) {
  const router = useRouter();
  const [data, setData] = useState(startup);

  useEffect(() => {
    setData(startup);
  }, [startup]);

  // Live updates via realtime when configured.
  useEffect(() => {
    const client = getBrowserClient();
    if (!client) return;
    const channel = client
      .channel(`startup-${startup.slug}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "startups",
          filter: `slug=eq.${startup.slug}`,
        },
        (payload) => {
          setData((prev) => ({ ...prev, ...(payload.new as Partial<Startup>) }));
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [startup.slug]);

  // Polling fallback while enrichment is running (no realtime configured).
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
      } catch {
        // ignore transient network errors
      }
    };

    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [data.slug, data.enrichment_status, router]);

  const founders = (data.founders ?? []) as Founder[];
  const enriched = hasEnrichmentData(data);
  const metaItems = META_FIELDS.filter(({ key }) => data[key]);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 24,
        marginBottom: 24,
        background: "var(--cream)",
        boxShadow: "0 1px 2px rgba(26,25,22,0.04)",
      }}
    >
      <h2 style={{ fontSize: 21, lineHeight: "35px", margin: "0 0 12px" }}>
        Enrichment
      </h2>

      {data.enrichment_status === "running" ? (
        <p style={{ fontSize: 13, color: "#616061" }}>enriching...</p>
      ) : !enriched ? (
        <p style={{ fontSize: 13, color: "#616061" }}>
          Not yet enriched. Click Enrich above to fetch company and founder data.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {metaItems.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 12,
              }}
            >
              {metaItems.map(({ key, label }) => (
                <div
                  key={key}
                  style={{
                    background: "#F7F7F7",
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#999999",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ fontSize: 14, color: "#171717" }}>
                    {data[key] as string}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.company_description && (
            <div>
              <h3
                style={{
                  fontSize: 13,
                  color: "#999999",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  margin: "0 0 8px",
                }}
              >
                Overview
              </h3>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: "22px",
                  color: "#171717",
                  margin: 0,
                }}
              >
                {data.company_description}
              </p>
            </div>
          )}

          {founders.length > 0 && (
            <div>
              <h3
                style={{
                  fontSize: 13,
                  color: "#999999",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  margin: "0 0 12px",
                }}
              >
                Founders
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {founders.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #F0F0F0",
                      borderRadius: 12,
                      padding: 16,
                      background: "#FFFFFF",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <div style={{ fontSize: 15, color: "#171717" }}>
                        {f.name || "Unknown"}
                      </div>
                      {f.linkedin && (
                        <a
                          href={f.linkedin}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 12,
                            color: "#007AFF",
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          linkedin →
                        </a>
                      )}
                    </div>
                    {f.background && (
                      <p
                        style={{
                          fontSize: 13,
                          lineHeight: "20px",
                          color: "#616061",
                          margin: "8px 0 0",
                        }}
                      >
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
