"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import type { Startup } from "../../lib/supabase";
import StatusBadge from "./StatusBadge";
import OutreachBadges from "./OutreachBadges";
import StartupActions from "./StartupActions";
import StartupEmbeds from "./StartupEmbeds";
import EnrichmentSection from "./EnrichmentSection";

type Props = {
  startup: Startup;
  onClose: () => void;
  onUpdate: (partial: Partial<Startup>) => void;
};

/** Right-side detail panel: same content as the full detail page, opened over the list with no navigation. */
export default function StartupPanel({ startup: s, onClose, onUpdate }: Props) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <>
      <div
        className="animate-fade-in"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.28)",
          zIndex: 550,
        }}
      />
      <div
        className="animate-slide-in-right"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(680px, 94vw)",
          background: "var(--page-bg)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-16px 0 48px rgba(0,0,0,0.18)",
          zIndex: 600,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Sticky top bar: close + open full page */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--page-bg)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 12.5,
              fontWeight: 500,
              cursor: "pointer",
              padding: "6px 8px",
              borderRadius: 6,
            }}
          >
            <X size={15} strokeWidth={2.2} />
            Close
          </button>
          <Link
            href={`/startups/${s.slug}`}
            target="_blank"
            title="Open full page in new tab"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 500,
              color: "var(--accent)",
              textDecoration: "none",
              padding: "6px 8px",
              borderRadius: 6,
            }}
          >
            Open full page
            <ExternalLink size={13} strokeWidth={2.2} />
          </Link>
        </div>

        {/* Scrollable body — independent of the page's own scroll */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 60px" }}>
          {/* Name row */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 20,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <h1
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    margin: 0,
                    color: "var(--heading)",
                    letterSpacing: "-0.03em",
                    lineHeight: 1.15,
                  }}
                >
                  {s.name}
                </h1>
                <StatusBadge status={s.status} />
                <OutreachBadges
                  stealth={s.stealth}
                  linkedinStatus={s.linkedin_status}
                  emailStatus={s.email_status}
                />
              </div>
              {s.one_liner && (
                <p style={{ fontSize: 14, color: "var(--label)", margin: "0 0 6px", lineHeight: 1.5 }}>
                  {s.one_liner}
                </p>
              )}
              {s.website && (
                <a
                  href={
                    s.website.startsWith("http://") || s.website.startsWith("https://") || s.website.startsWith("//")
                      ? s.website
                      : `https://${s.website}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none", opacity: 0.8 }}
                >
                  {s.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>

            <div style={{ flexShrink: 0, position: "relative", zIndex: 20 }} data-no-nav>
              <StartupActions
                slug={s.slug}
                name={s.name}
                status={s.status}
                enrichmentStatus={s.enrichment_status}
                companyDescription={s.company_description}
                founders={s.founders}
                stealth={s.stealth}
                linkedinStatus={s.linkedin_status}
                emailStatus={s.email_status}
                onUpdate={onUpdate}
              />
            </div>
          </div>

          <StartupEmbeds website={s.website} />

          {/* Assessment */}
          <Section title="Assessment">
            <p
              style={{
                fontSize: 13.5,
                lineHeight: "22px",
                color: "var(--body)",
                margin: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {s.assessment || "No assessment yet."}
            </p>
          </Section>

          {/* Enrichment */}
          <EnrichmentSection
            startup={{
              slug: s.slug,
              enrichment_status: s.enrichment_status,
              company_description: s.company_description,
              founders: s.founders,
              stage: s.stage,
              raised: s.raised,
              location: s.location,
              founded: s.founded,
              team_size: s.team_size,
            }}
          />

          {/* Signal URLs */}
          {s.signal_urls && s.signal_urls.length > 0 && (
            <Section title="Signal URLs">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {s.signal_urls.map((u, i) => (
                  <a
                    key={i}
                    href={u.startsWith("http://") || u.startsWith("https://") || u.startsWith("//") ? u : `https://${u}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 13,
                      color: "var(--accent)",
                      textDecoration: "none",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {u}
                  </a>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
      <h2
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--label)",
          margin: "0 0 12px",
          letterSpacing: "0.07em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}
