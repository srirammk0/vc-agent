"use client";

import { useState, useMemo } from "react";
import type { Signal } from "../hooks/useLiveSignals";
import { useRouter } from "next/navigation";

type Category = "social" | "developer" | "ai_infra" | "accelerator" | "traction";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "social", label: "Social & Founders" },
  { id: "developer", label: "Developer & Open Source" },
  { id: "ai_infra", label: "AI Infrastructure" },
  { id: "accelerator", label: "Accelerators & Directories" },
  { id: "traction", label: "Traction & Hiring" },
];

export default function SignalsPanel({ signals }: { signals: Signal[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Record<Category, boolean>>({
    social: true,
    developer: true,
    ai_infra: true,
    accelerator: true,
    traction: true,
  });

  const [busy, setBusy] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const acc: Record<Category, Signal[]> = {
      social: [],
      developer: [],
      ai_infra: [],
      accelerator: [],
      traction: [],
    };
    signals.forEach((s) => {
      if (s.status === "new" && acc[s.category as Category]) {
        acc[s.category as Category].push(s);
      }
    });
    return acc;
  }, [signals]);

  const toggle = (c: Category) => {
    setExpanded((prev) => ({ ...prev, [c]: !prev[c] }));
  };

  async function sendSignal(id: string) {
    setBusy(id);
    await fetch("/api/signals/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(null);
    router.refresh();
  }

  async function dismissSignal(id: string) {
    setBusy(id);
    await fetch(`/api/signals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {CATEGORIES.map((cat) => {
        const catSignals = byCategory[cat.id];
        const isExpanded = expanded[cat.id];

        if (catSignals.length === 0) return null;

        return (
          <div key={cat.id} className="signal-category-block">
            {/* Header */}
            <button
              onClick={() => toggle(cat.id)}
              className="signal-category-header"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: isExpanded ? "10px 10px 0 0" : "10px",
                borderBottom: isExpanded ? "none" : "1px solid var(--border)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--heading)" }}>
                  {cat.label}
                </span>
                <span
                  style={{
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  {catSignals.length}
                </span>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  color: "var(--muted)",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Body */}
            <div
              className="signal-category-body"
              style={{
                maxHeight: isExpanded ? "2000px" : "0px",
                overflow: "hidden",
                transition: "max-height 0.3s ease-in-out",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderTop: "none",
                borderRadius: "0 0 10px 10px",
              }}
            >
              <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
                {catSignals.map((s) => (
                  <div
                    key={s.id}
                    className="signal-card"
                    style={{
                      background: "var(--card-bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "16px",
                      display: "flex",
                      gap: 16,
                    }}
                  >
                    {/* Favicon */}
                    <div style={{ flexShrink: 0, marginTop: 2 }}>
                      {s.favicon_url ? (
                        <img
                          src={s.favicon_url}
                          alt=""
                          style={{ width: 24, height: 24, borderRadius: 4 }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            background: "var(--border)",
                          }}
                        />
                      )}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 6,
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                            <a
                              href={s.source_url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: 15,
                                fontWeight: 600,
                                color: "var(--heading)",
                                textDecoration: "none",
                              }}
                            >
                              {s.title}
                            </a>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 500,
                                color: "var(--label)",
                                background: "rgba(0,0,0,0.05)",
                                padding: "2px 6px",
                                borderRadius: 4,
                              }}
                            >
                              {s.platform}
                            </span>
                            {s.signal_type && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: "var(--accent)",
                                  background: "rgba(0,122,255,0.08)",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                }}
                              >
                                {s.signal_type}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 12 }}>
                            <span>Score: {s.score}</span>
                            {s.ai_features && s.ai_features.length > 0 && (
                              <span>Tech: {s.ai_features.join(", ")}</span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                          <button
                            onClick={() => sendSignal(s.id)}
                            disabled={busy === s.id}
                            style={{
                              height: 28,
                              padding: "0 12px",
                              borderRadius: 5,
                              border: "none",
                              background: "var(--accent)",
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: busy === s.id ? "not-allowed" : "pointer",
                              opacity: busy === s.id ? 0.6 : 1,
                            }}
                          >
                            {busy === s.id ? "..." : "Research"}
                          </button>
                          <button
                            onClick={() => dismissSignal(s.id)}
                            disabled={busy === s.id}
                            style={{
                              height: 28,
                              width: 28,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 5,
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--label)",
                              cursor: busy === s.id ? "not-allowed" : "pointer",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <p
                        style={{
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "var(--body)",
                          margin: 0,
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {s.snippet}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
