"use client";

import type { Startup } from "../../lib/supabase";
import StatusBadge from "./StatusBadge";
import OutreachBadges from "./OutreachBadges";
import StartupActions from "./StartupActions";
import StartupEmbeds from "./StartupEmbeds";
import EnrichmentSection from "./EnrichmentSection";

type Props = {
  startup: Startup;
  onUpdate: (partial: Partial<Startup>) => void;
};

/** Shared by the full detail page and the dashboard's slide-over panel — one source of truth for a startup's detail content. */
export default function StartupDetailBody({ startup: s, onUpdate }: Props) {
  return (
    <>
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
              followupCount={s.followup_count}
              lastFollowupAt={s.last_followup_at}
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
            enrichmentUpdatedAt={s.updated_at}
            companyDescription={s.company_description}
            founders={s.founders}
            enriched={s.enriched}
            stealth={s.stealth}
            linkedinStatus={s.linkedin_status}
            emailStatus={s.email_status}
            followupCount={s.followup_count}
            lastFollowupAt={s.last_followup_at}
            onUpdate={onUpdate}
          />
        </div>
      </div>

      <StartupEmbeds website={s.website} />

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

      <EnrichmentSection
        startup={{
          slug: s.slug,
          enrichment_status: s.enrichment_status,
          updated_at: s.updated_at,
          company_description: s.company_description,
          founders: s.founders,
          stage: s.stage,
          raised: s.raised,
          location: s.location,
          founded: s.founded,
          team_size: s.team_size,
        }}
      />

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
