"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Founder, Startup } from "../../lib/supabase";
import { hasEnrichmentData } from "../../lib/enrichment";

type Props = {
  startup: Pick<
    Startup,
    | "slug"
    | "enrichment_status"
    | "company_description"
    | "founders"
    | "stage"
    | "raised"
    | "location"
    | "founded"
    | "team_size"
  >;
};

export default function EnrichmentSection({ startup }: Props) {
  const router = useRouter();
  const [data, setData] = useState(startup);

  useEffect(() => {
    setData(startup);
  }, [startup]);

  useEffect(() => {
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

  return (
    <div
      style={{
        border: "1px solid #F0F0F0",
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)",
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data.company_description && (
            <p style={{ fontSize: 14, lineHeight: "20px" }}>
              {data.company_description}
            </p>
          )}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
            {data.stage && <Meta label="Stage" value={data.stage} />}
            {data.raised && <Meta label="Raised" value={data.raised} />}
            {data.location && <Meta label="Location" value={data.location} />}
            {data.founded && <Meta label="Founded" value={data.founded} />}
            {data.team_size && <Meta label="Team size" value={data.team_size} />}
          </div>
          {founders.length > 0 && (
            <div>
              <h3 style={{ fontSize: 21, margin: "8px 0" }}>Founders</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {founders.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #F0F0F0",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <div style={{ fontSize: 14 }}>{f.name || "Unknown"}</div>
                    {f.background && (
                      <div
                        style={{ fontSize: 13, color: "#616061", marginTop: 4 }}
                      >
                        {f.background}
                      </div>
                    )}
                    {f.linkedin && (
                      <a
                        href={f.linkedin}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 13,
                          color: "#007AFF",
                          textDecoration: "none",
                        }}
                      >
                        profile
                      </a>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "#999999", fontSize: 12 }}>{label}</div>
      <div style={{ color: "#171717", fontSize: 14 }}>{value}</div>
    </div>
  );
}
