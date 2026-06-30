"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useEnrichmentPoll } from "../hooks/useEnrichmentPoll";
import { hasEnrichmentData, showEnrichButton } from "../../lib/enrichment";
import type { Founder } from "../../lib/supabase";

type Status = "new" | "approved" | "passed";

type Props = {
  slug: string;
  name: string;
  status: Status;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEnrichmentPoll(slug, enrichmentStatus);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

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

  const enriched = hasEnrichmentData({
    company_description: companyDescription,
    founders,
    stage: null,
    raised: null,
    location: null,
    founded: null,
    team_size: null,
  });

  async function setStatus(next: Status) {
    setMenuOpen(false);
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

  const MENU: { value: Status; label: string; color: string; dot: string }[] = [
    { value: "approved", label: "Mark approved", color: "#1FAE67", dot: "#1FAE67" },
    { value: "passed", label: "Mark passed", color: "#E5484D", dot: "#E5484D" },
    { value: "new", label: "Mark new", color: "#6B6862", dot: "#9C988F" },
  ];

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
      {enrichmentStatus === "running" && (
        <span style={{ fontSize: 12, color: "#9C988F" }}>enriching…</span>
      )}
      {status === "approved" && enriched && enrichmentStatus !== "running" && (
        <span style={{ fontSize: 12, color: "#1FAE67" }}>enriched</span>
      )}

      {enrichVisible && (
        <button
          onClick={enrich}
          disabled={disabled}
          style={{
            height: 34,
            padding: "0 14px",
            borderRadius: 9,
            border: "0 solid transparent",
            background: "#007AFF",
            color: "#fff",
            fontSize: 13,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
            boxShadow: "0 3px 10px rgba(0,122,255,0.25)",
          }}
        >
          {busy === "enrich" ? "enriching…" : "Enrich"}
        </button>
      )}

      <div ref={menuRef} style={{ position: "relative" }}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          disabled={disabled}
          aria-label="Change status"
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            border: "1px solid var(--border-med, #E2DDD2)",
            background: menuOpen ? "#F5F3EC" : "#fff",
            color: "#6B6862",
            cursor: disabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>

        {menuOpen && (
          <div
            className="menu-pop"
            style={{
              position: "absolute",
              right: 0,
              top: 40,
              width: 184,
              background: "#fff",
              border: "1px solid var(--border, #ECE8DF)",
              borderRadius: 12,
              boxShadow: "0 12px 28px rgba(26,25,22,0.14)",
              padding: 6,
              zIndex: 30,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#9C988F",
                padding: "6px 10px 4px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Change status
            </div>
            {MENU.filter((m) => m.value !== status).map((m) => (
              <button
                key={m.value}
                className="menu-item"
                onClick={() => setStatus(m.value)}
                style={{ color: m.color }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: m.dot,
                  }}
                />
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
