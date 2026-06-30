"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useEnrichmentPoll } from "../hooks/useEnrichmentPoll";
import { showEnrichButton } from "../../lib/enrichment";
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

const MENU_ITEMS: { value: Status; label: string; accent: string }[] = [
  { value: "approved", label: "Mark approved", accent: "var(--success)" },
  { value: "passed",   label: "Mark passed",   accent: "var(--danger)"  },
  { value: "new",      label: "Mark new",       accent: "var(--label)"   },
];

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

  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
      {enrichVisible && (
        <button
          onClick={enrich}
          disabled={disabled}
          style={{
            height: 32,
            padding: "0 13px",
            borderRadius: 5,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.55 : 1,
            boxShadow: "0 2px 8px rgba(0,122,255,0.25)",
            transition: "opacity 0.15s ease, box-shadow 0.15s ease",
            whiteSpace: "nowrap",
          }}
        >
          {busy === "enrich" ? "Enriching…" : "Enrich"}
        </button>
      )}

      {/* Three-dot menu */}
      <div ref={menuRef} style={{ position: "relative" }}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          disabled={disabled}
          aria-label="Change status"
          style={{
            width: 32,
            height: 32,
            borderRadius: 5,
            border: "1px solid var(--border)",
            background: menuOpen ? "rgba(0,122,255,0.06)" : "rgba(255,255,255,0.7)",
            color: menuOpen ? "var(--accent)" : "var(--label)",
            cursor: disabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.5 : 1,
            transition: "background 0.15s ease, color 0.15s ease",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5"  r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </svg>
        </button>

        {menuOpen && (
          <div
            className="menu-pop"
            style={{
              position: "absolute",
              right: 0,
              top: 38,
              width: 176,
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.06)",
              padding: 5,
              zIndex: 200,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                color: "var(--muted)",
                padding: "5px 10px 3px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 500,
              }}
            >
              Change status
            </div>
            {MENU_ITEMS.filter((m) => m.value !== status).map((m) => (
              <button
                key={m.value}
                className="menu-item"
                onClick={() => setStatus(m.value)}
                style={{
                  color: m.accent,
                  fontSize: 13,
                  fontWeight: 400,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: m.accent,
                    flexShrink: 0,
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
