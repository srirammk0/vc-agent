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
        background: "#FFFFFF",
        color: "#171717",
        fontFamily:
          "'Aeonik Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <nav
        style={{
          height: 58,
          background: "#000000",
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
        }}
      >
        <Link href="/" style={{ fontSize: 16, color: "#FFFFFF", textDecoration: "none" }}>
          ← VC Scout
        </Link>
      </nav>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: 32, lineHeight: "44px", margin: 0 }}>{s.name}</h1>
          <StatusBadge status={s.status} />
        </div>
        {s.one_liner && (
          <p style={{ fontSize: 16, color: "#616061", margin: "0 0 8px" }}>
            {s.one_liner}
          </p>
        )}
        {s.website && (
          <a
            href={s.website}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 14, color: "#007AFF", textDecoration: "none" }}
          >
            {s.website.replace(/^https?:\/\//, "")}
          </a>
        )}

        <div style={{ margin: "24px 0" }}>
          <StartupActions
            slug={s.slug}
            name={s.name}
            status={s.status}
            enrichmentStatus={s.enrichment_status}
            companyDescription={s.company_description}
            founders={s.founders}
          />
        </div>

        {/* Assessment */}
        <Section title="Assessment">
          <p style={{ fontSize: 14, lineHeight: "20px", whiteSpace: "pre-wrap" }}>
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

        {/* Signals */}
        {s.signal_urls && s.signal_urls.length > 0 && (
          <Section title="Signal URLs">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {s.signal_urls.map((u, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                  <a
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#007AFF", textDecoration: "none" }}
                  >
                    {u}
                  </a>
                </li>
              ))}
            </ul>
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
        border: "1px solid #F0F0F0",
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)",
      }}
    >
      <h2 style={{ fontSize: 21, lineHeight: "35px", margin: "0 0 12px" }}>{title}</h2>
      {children}
    </div>
  );
}
