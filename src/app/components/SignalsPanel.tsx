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

  const [page, setPage] = useState<Record<Category, number>>({
    social: 1,
    developer: 1,
    ai_infra: 1,
    accelerator: 1,
    traction: 1,
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
      {CATEGORIES.map((cat, i) => {
        const catSignals = byCategory[cat.id];
        const isExpanded = expanded[cat.id];
        
        const ITEMS_PER_PAGE = 5;
        const totalPages = Math.max(1, Math.ceil(catSignals.length / ITEMS_PER_PAGE));
        const currentPage = page[cat.id] || 1;
        const paginatedSignals = catSignals.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

        return (
          <div
            key={cat.id}
            className="signal-category-block row-enter"
            style={{
              width: "100%",
              animationDelay: `${i * 35}ms`,
            }}
          >
            {/* Header */}
            <button
              onClick={() => toggle(cat.id)}
              className="signal-category-header"
              style={{
                width: "65%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: "var(--heading)" }}>
                  {cat.label}
                </span>
                <span
                  style={{
                    background: "rgba(0, 0, 0, 0.07)",
                    color: "var(--body)",
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
                display: "grid",
                gridTemplateRows: isExpanded ? "1fr" : "0fr",
                opacity: isExpanded ? 1 : 0,
                transition: "grid-template-rows 0.45s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.35s ease-out",
              }}
            >
              <div style={{ minHeight: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {
                  paginatedSignals.map((s) => (
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
                  ))
                }
                {totalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, borderTop: "1px solid var(--border-med)", paddingTop: 12 }}>
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setPage(p => ({ ...p, [cat.id]: currentPage - 1 }))}
                      style={{
                        background: "transparent", border: "1px solid var(--border)", borderRadius: "6px",
                        padding: "6px 12px", fontSize: "12px", fontWeight: 500, color: "var(--label)",
                        cursor: currentPage === 1 ? "not-allowed" : "pointer", opacity: currentPage === 1 ? 0.4 : 1
                      }}
                    >
                      Previous
                    </button>
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>Page {currentPage} of {totalPages}</span>
                    <button
                      disabled={currentPage === totalPages}
                      onClick={() => setPage(p => ({ ...p, [cat.id]: currentPage + 1 }))}
                      style={{
                        background: "transparent", border: "1px solid var(--border)", borderRadius: "6px",
                        padding: "6px 12px", fontSize: "12px", fontWeight: 500, color: "var(--label)",
                        cursor: currentPage === totalPages ? "not-allowed" : "pointer", opacity: currentPage === totalPages ? 0.4 : 1
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
