"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useEnrichmentPoll } from "../hooks/useEnrichmentPoll";
import { hasEnrichmentData, showEnrichButton } from "../../lib/enrichment";
import type { Founder } from "../../lib/supabase";

type Props = {
  slug: string;
  name: string;
  status: "new" | "approved" | "passed";
  enrichmentStatus: "pending" | "running" | "complete";
  companyDescription: string | null;
  founders: Founder[] | null;
};

export default function StartupActions({
  slug,
  name,
  status,
  enrichmentStatus,
  companyDescription,
  founders,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  useEnrichmentPoll(slug, enrichmentStatus);

  const enrichVisible = showEnrichButton({
    status,
    enrichment_status: enrichmentStatus,
    company_description: companyDescription,
    founders,
    stage: null,
    raised: null,
    location: null,
    founded: null,
    team_size: null,
  });

  async function setStatus(next: "approved" | "passed") {
    setBusy(next);
    await fetch(`/api/startup/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(null);
    startTransition(() => router.refresh());
  }

  async function enrich() {
    setBusy("enrich");
    await fetch(`/api/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name }),
    });
    setBusy(null);
    startTransition(() => router.refresh());
  }

  const disabled = isPending || busy !== null;
  const enriched = hasEnrichmentData({
    company_description: companyDescription,
    founders,
    stage: null,
    raised: null,
    location: null,
    founded: null,
    team_size: null,
  });

  return (
    <div
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
    >
      {status !== "approved" && (
        <button
          onClick={() => setStatus("approved")}
          disabled={disabled}
          style={{
            height: 36,
            padding: "0 16px",
            borderRadius: 8,
            border: "1px solid #86FC6F",
            background: "#86FC6F",
            color: "#061F00",
            fontSize: 13,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {busy === "approved" ? "..." : "Approve"}
        </button>
      )}
      {status !== "passed" && (
        <button
          onClick={() => setStatus("passed")}
          disabled={disabled}
          style={{
            height: 36,
            padding: "0 16px",
            borderRadius: 8,
            border: "1px solid #D1D1D1",
            background: "#F0F0F0",
            color: "#171717",
            fontSize: 13,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {busy === "passed" ? "..." : "Pass"}
        </button>
      )}
      {enrichVisible && (
        <button
          onClick={enrich}
          disabled={disabled}
          style={{
            height: 36,
            padding: "0 16px",
            borderRadius: 8,
            border: "0px solid transparent",
            background: "#007AFF",
            color: "#FFFFFF",
            fontSize: 13,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
            boxShadow: "0px 4px 12px rgba(0, 122, 255, 0.25)",
          }}
        >
          {busy === "enrich" ? "enriching..." : "Enrich"}
        </button>
      )}
      {status === "approved" && enrichmentStatus === "running" && (
        <span style={{ fontSize: 12, color: "#616061" }}>enriching...</span>
      )}
      {status === "approved" && enriched && (
        <span style={{ fontSize: 12, color: "#007A5A" }}>enriched</span>
      )}
    </div>
  );
}
