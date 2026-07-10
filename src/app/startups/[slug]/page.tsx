import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase, type Startup } from "../../../lib/supabase";
import StatusBadge from "../../components/StatusBadge";
import StartupActions from "../../components/StartupActions";
import EnrichmentSection from "../../components/EnrichmentSection";

export const dynamic = "force-dynamic";

export default async function StartupDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data } = await supabase
    .from("startups")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) notFound();
  const s = data as Startup;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--page-bg)",
        color: "var(--body)",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 60px" }}>

        {/* Back + header */}
        <div style={{ marginBottom: 28 }}>
          <Link
            href="/"
            className="back-link"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
            </svg>
            Dealflow
          </Link>

          {/* Name row */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <h1
                  style={{
                    fontSize: 26,
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
              </div>
              {s.one_liner && (
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--label)",
                    margin: "0 0 6px",
                    lineHeight: 1.5,
                  }}
                >
                  {s.one_liner}
                </p>
              )}
              {s.website && (
                <a
                  href={s.website.startsWith("http://") || s.website.startsWith("https://") || s.website.startsWith("//") ? s.website : `https://${s.website}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12.5,
                    color: "var(--accent)",
                    textDecoration: "none",
                    opacity: 0.8,
                  }}
                >
                  {s.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>

            {/* Actions */}
            <div style={{ flexShrink: 0, position: "relative", zIndex: 20 }}>
              <StartupActions
                slug={s.slug}
                name={s.name}
                status={s.status}
                enrichmentStatus={s.enrichment_status}
                companyDescription={s.company_description}
                founders={s.founders}
              />
            </div>
          </div>
        </div>

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
    </main>
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
