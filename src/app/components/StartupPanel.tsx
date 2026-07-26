"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import type { Startup } from "../../lib/supabase";
import StartupDetailBody from "./StartupDetailBody";
import { useEscapeKey } from "../hooks/useEscapeKey";

type Props = {
  startup: Startup;
  onClose: () => void;
  onUpdate: (partial: Partial<Startup>) => void;
};

/** Right-side detail panel: same content as the full detail page, opened over the list with no navigation. */
export default function StartupPanel({ startup: s, onClose, onUpdate }: Props) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEscapeKey(true, onClose);

  return (
    <>
      <div
        className="animate-fade-in"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.28)",
          zIndex: 550,
        }}
      />
      <div
        className="animate-slide-in-right"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(680px, 94vw)",
          background: "var(--page-bg)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-16px 0 48px rgba(0,0,0,0.18)",
          zIndex: 600,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Sticky top bar: close + open full page */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--page-bg)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 12.5,
              fontWeight: 500,
              cursor: "pointer",
              padding: "6px 8px",
              borderRadius: 6,
            }}
          >
            <X size={15} strokeWidth={2.2} />
            Close
          </button>
          <Link
            href={`/startups/${s.slug}`}
            target="_blank"
            title="Open full page in new tab"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 500,
              color: "var(--accent)",
              textDecoration: "none",
              padding: "6px 8px",
              borderRadius: 6,
            }}
          >
            Open full page
            <ExternalLink size={13} strokeWidth={2.2} />
          </Link>
        </div>

        {/* Scrollable body — independent of the page's own scroll */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 60px" }}>
          <StartupDetailBody startup={s} onUpdate={onUpdate} />
        </div>
      </div>
    </>
  );
}
