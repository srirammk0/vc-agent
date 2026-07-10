import { ArrowLeft } from "lucide-react";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import { Card, Stack, Text } from "@astryxdesign/core";
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
    <main style={{ minHeight: "100vh", background: "var(--color-background-body)", color: "var(--color-text-primary)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 60px" }}>
        <Stack direction="vertical" gap={4} style={{ marginBottom: 28 }}>
          <NextLink href="/" className="back-link">
            <Stack direction="horizontal" gap={1} vAlign="center">
              <ArrowLeft size={14} />
              Dealflow
            </Stack>
          </NextLink>

          <Stack direction="horizontal" hAlign="between" vAlign="start" gap={4} style={{ flexWrap: "wrap" }}>
            <Stack direction="vertical" gap={2} style={{ minWidth: 0 }}>
              <Stack direction="horizontal" gap={2} vAlign="center" style={{ flexWrap: "wrap" }}>
                <Text type="display-2" size="2xl">{s.name}</Text>
                <StatusBadge status={s.status} />
              </Stack>
              {s.one_liner && (
                <Text type="body" size="sm" color="secondary">{s.one_liner}</Text>
              )}
              {s.website && (
                <a
                  href={s.website.startsWith("http") ? s.website : `https://${s.website}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12.5, color: "var(--color-accent)", textDecoration: "none", opacity: 0.85 }}
                >
                  {s.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </Stack>

            <StartupActions
              slug={s.slug}
              name={s.name}
              status={s.status}
              enrichmentStatus={s.enrichment_status}
              companyDescription={s.company_description}
              founders={s.founders}
            />
          </Stack>
        </Stack>

        <Stack direction="vertical" gap={4}>
          <Section title="Assessment">
            <Text type="body" size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {s.assessment || "No assessment yet."}
            </Text>
          </Section>

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

          {s.signal_urls && s.signal_urls.length > 0 && (
            <Section title="Signal URLs">
              <Stack direction="vertical" gap={2}>
                {s.signal_urls.map((u, i) => (
                  <a
                    key={i}
                    href={u.startsWith("http") ? u : `https://${u}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 13,
                      color: "var(--color-accent)",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {u}
                  </a>
                ))}
              </Stack>
            </Section>
          )}
        </Stack>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <Stack direction="vertical" gap={3}>
        <Text type="label" size="xsm" color="secondary">{title}</Text>
        {children}
      </Stack>
    </Card>
  );
}
