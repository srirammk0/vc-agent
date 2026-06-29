import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase, type Startup, type Founder } from "../../../lib/supabase";
import StatusBadge from "../../components/StatusBadge";
import StartupActions from "../../components/StartupActions";

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
  const founders = (s.founders ?? []) as Founder[];

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
          />
        </div>

        {/* Assessment */}
        <Section title="Assessment">
          <p style={{ fontSize: 14, lineHeight: "20px", whiteSpace: "pre-wrap" }}>
            {s.assessment || "No assessment yet."}
          </p>
        </Section>

        {/* Enrichment */}
        <Section title="Enrichment">
          {s.enrichment_status !== "complete" ? (
            <p style={{ fontSize: 13, color: "#616061" }}>
              {s.enrichment_status === "running"
                ? "enriching..."
                : "Not yet enriched."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {s.company_description && (
                <p style={{ fontSize: 14, lineHeight: "20px" }}>
                  {s.company_description}
                </p>
              )}
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
                {s.stage && <Meta label="Stage" value={s.stage} />}
                {s.raised && <Meta label="Raised" value={s.raised} />}
                {s.location && <Meta label="Location" value={s.location} />}
                {s.founded && <Meta label="Founded" value={s.founded} />}
                {s.team_size && <Meta label="Team size" value={s.team_size} />}
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
                          <div style={{ fontSize: 13, color: "#616061", marginTop: 4 }}>
                            {f.background}
                          </div>
                        )}
                        {f.linkedin && (
                          <a
                            href={f.linkedin}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: 13, color: "#007AFF", textDecoration: "none" }}
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
        </Section>

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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "#999999", fontSize: 12 }}>{label}</div>
      <div style={{ color: "#171717", fontSize: 14 }}>{value}</div>
    </div>
  );
}
