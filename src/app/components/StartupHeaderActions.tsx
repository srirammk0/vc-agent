"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "../../lib/supabaseBrowser";
import type { Startup } from "../../lib/supabase";
import StatusBadge from "./StatusBadge";
import OutreachBadges from "./OutreachBadges";
import StartupActions from "./StartupActions";

type Props = {
  startup: Pick<
    Startup,
    | "slug"
    | "name"
    | "status"
    | "enrichment_status"
    | "company_description"
    | "founders"
    | "stealth"
    | "linkedin_status"
    | "email_status"
  >;
  oneLiner: string | null;
  website: string | null;
};

/**
 * Renders the detail page's title row (name + badges + actions) as one
 * client boundary so status/outreach changes reflect live, without a
 * full page reload, and stay reconciled via realtime.
 */
export default function StartupHeaderActions({ startup, oneLiner, website }: Props) {
  const [data, setData] = useState(startup);

  useEffect(() => setData(startup), [startup]);

  useEffect(() => {
    const client = getBrowserClient();
    if (!client) return;
    const channel = client
      .channel(`startup-header-${data.slug}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "startups", filter: `slug=eq.${data.slug}` },
        (payload) => setData((prev) => ({ ...prev, ...(payload.new as Partial<Startup>) }))
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [data.slug]);

  return (
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
            {data.name}
          </h1>
          <StatusBadge status={data.status} />
          <OutreachBadges
            stealth={data.stealth}
            linkedinStatus={data.linkedin_status}
            emailStatus={data.email_status}
          />
        </div>
        {oneLiner && (
          <p
            style={{
              fontSize: 14,
              color: "var(--label)",
              margin: "0 0 6px",
              lineHeight: 1.5,
            }}
          >
            {oneLiner}
          </p>
        )}
        {website && (
          <a
            href={
              website.startsWith("http://") || website.startsWith("https://") || website.startsWith("//")
                ? website
                : `https://${website}`
            }
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 12.5,
              color: "var(--accent)",
              textDecoration: "none",
              opacity: 0.8,
            }}
          >
            {website.replace(/^https?:\/\//, "")}
          </a>
        )}
      </div>

      <div style={{ flexShrink: 0, position: "relative", zIndex: 20 }}>
        <StartupActions
          slug={data.slug}
          name={data.name}
          status={data.status}
          enrichmentStatus={data.enrichment_status}
          companyDescription={data.company_description}
          founders={data.founders}
          stealth={data.stealth}
          linkedinStatus={data.linkedin_status}
          emailStatus={data.email_status}
          onUpdate={(partial) => setData((prev) => ({ ...prev, ...partial }))}
        />
      </div>
    </div>
  );
}
