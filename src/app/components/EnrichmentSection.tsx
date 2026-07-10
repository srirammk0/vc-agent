"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, MetadataList, MetadataListItem, Stack, Text } from "@astryxdesign/core";
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

  useEffect(() => {
    const client = getBrowserClient();
    if (!client) return;
    const channel = client
      .channel(`startup-${startup.slug}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "startups", filter: `slug=eq.${startup.slug}` },
        (payload) => {
          setData((prev) => ({ ...prev, ...(payload.new as Partial<Startup>) }));
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
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
      } catch {
        // ignore
      }
    };
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [data.slug, data.enrichment_status, router]);

  const founders = (data.founders ?? []) as Founder[];
  const enriched = hasEnrichmentData(data);
  const metaItems = META_FIELDS.filter(({ key }) => data[key]);
  const isRunning = data.enrichment_status === "running";

  return (
    <Card>
      <Stack direction="vertical" gap={4}>
        <Stack direction="horizontal" gap={2} vAlign="center">
          <Text type="label" size="xsm" color="secondary">Enrichment</Text>
          {isRunning && <Badge label="enriching…" variant="info" />}
          {enriched && !isRunning && <Badge label="enriched" variant="success" />}
        </Stack>

        {isRunning ? (
          <Text type="body" size="sm" color="secondary">Fetching company and founder data…</Text>
        ) : !enriched ? (
          <Text type="body" size="sm" color="disabled">
            Not yet enriched. Click Enrich to fetch company and founder data.
          </Text>
        ) : (
          <Stack direction="vertical" gap={5}>
            {metaItems.length > 0 && (
              <MetadataList columns="multi">
                {metaItems.map(({ key, label }) => (
                  <MetadataListItem key={key} label={label}>
                    {data[key] as string}
                  </MetadataListItem>
                ))}
              </MetadataList>
            )}

            {data.company_description && (
              <Stack direction="vertical" gap={2}>
                <Text type="label" size="xsm" color="secondary">Overview</Text>
                <Text type="body" size="sm">{data.company_description}</Text>
              </Stack>
            )}

            {founders.length > 0 && (
              <Stack direction="vertical" gap={2}>
                <Text type="label" size="xsm" color="secondary">Founders</Text>
                <Stack direction="vertical" gap={2}>
                  {founders.map((f, i) => (
                    <Card key={i} variant="muted" padding={3}>
                      <Stack direction="vertical" gap={1}>
                        <Stack direction="horizontal" hAlign="between" vAlign="center" gap={2}>
                          <Text type="label" size="sm" weight="semibold">{f.name || "Unknown"}</Text>
                          {f.linkedin && (
                            <a
                              href={f.linkedin.startsWith("http") ? f.linkedin : `https://${f.linkedin}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 12, color: "var(--color-accent)", textDecoration: "none" }}
                            >
                              LinkedIn →
                            </a>
                          )}
                        </Stack>
                        {f.background && (
                          <Text type="body" size="sm" color="secondary">{f.background}</Text>
                        )}
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
