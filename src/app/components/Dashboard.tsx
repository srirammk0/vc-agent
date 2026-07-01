"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Startup } from "../../lib/supabase";
import { hasEnrichmentData } from "../../lib/enrichment";
import { sortStartups } from "../../lib/sortStartups";
import { useLiveStartups } from "../hooks/useLiveStartups";
import StatusBadge from "./StatusBadge";
import StartupActions from "./StartupActions";
import CommandPalette from "./CommandPalette";
import SignalsPanel from "./SignalsPanel";
import { useLiveSignals, type Signal } from "../hooks/useLiveSignals";

type Tab = "all" | "new" | "approved" | "passed" | "signals";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "approved", label: "Approved" },
  { id: "passed", label: "Passed" },
  { id: "signals", label: "Signals" },
];

const TAB_COUNT_BADGE: Record<Tab, { bg: string; color: string }> = {
  all: { bg: "rgba(0, 0, 0, 0.1)", color: "var(--heading)" },
  new: { bg: "var(--accent)", color: "#fff" },
  approved: { bg: "var(--success)", color: "#fff" },
  passed: { bg: "var(--danger)", color: "#fff" },
  signals: { bg: "var(--warning)", color: "#fff" },
};

function truncate(text: string | null, n: number): string {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).trimEnd() + "…" : text;
}

function HeroLoader() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--page-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        zIndex: 200,
      }}
      className="animate-fade-in"
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          VC Scout
        </div>
        <div
          style={{
            fontSize: 32,
            color: "var(--heading)",
            letterSpacing: "-0.025em",
            fontWeight: 600,
          }}
        >
          Dealflow Agent
        </div>
      </div>
      <div
        style={{
          position: "relative",
          width: 200,
          height: 3,
          borderRadius: 999,
          background: "rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            borderRadius: 999,
            background: "var(--accent)",
            animation: "indeterminate 1.1s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}

export default function Dashboard({ initial, initialSignals }: { initial: Startup[], initialSignals: Signal[] }) {
  const { startups, refresh: refreshStartups, refreshing: refreshingStartups } = useLiveStartups(initial);
  const { signals, refresh: refreshSignals, refreshing: refreshingSignals } = useLiveSignals(initialSignals);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [booting, setBooting] = useState(true);
  const [isMac, setIsMac] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<string | null>(null);

  async function clearAllSignals() {
    if (!confirm("Are you sure you want to clear all active signals?")) return;
    setClearing(true);
    try {
      await fetch("/api/signals", { method: "DELETE" });
      await refreshSignals();
    } catch (e) {
      console.error(e);
    }
    setClearing(false);
  }

  async function handleBatchStatus(status: "new" | "approved" | "passed") {
    if (selectedSlugs.size === 0) return;
    setBatchBusy(status);
    try {
      await fetch("/api/startups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slugs: Array.from(selectedSlugs),
          status,
        }),
      });
      setSelectedSlugs(new Set());
      await refreshStartups();
    } catch (e) {
      console.error("Batch update failed:", e);
    }
    setBatchBusy(null);
  }

  useEffect(() => {
    setSelectedSlugs(new Set());
  }, [tab]);

  useEffect(() => {
    setIsMac(
      typeof navigator !== "undefined" &&
        /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    );

    if (typeof window !== "undefined") {
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
      }
      window.scrollTo(0, 0);
    }

    const t = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(t);
  }, []);

  const counts = useMemo(
    () => ({
      total: startups.length,
      new: startups.filter((s) => s.status === "new").length,
      approved: startups.filter((s) => s.status === "approved").length,
      passed: startups.filter((s) => s.status === "passed").length,
      signals: signals.filter((s) => s.status === "new").length,
    }),
    [startups, signals]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = startups
      .filter((s) => (tab === "all" ? true : s.status === tab))
      .filter((s) =>
        q
          ? s.name.toLowerCase().includes(q) ||
            (s.one_liner ?? "").toLowerCase().includes(q) ||
            (s.assessment ?? "").toLowerCase().includes(q)
          : true
      );
    return sortStartups(rows);
  }, [startups, tab, query]);

  const showLoader = booting || refreshingStartups || refreshingSignals;

  return (
    <main style={{ minHeight: "100vh", background: "var(--page-bg)", color: "var(--body)" }}>
      {showLoader && <HeroLoader />}
      <CommandPalette startups={startups} />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 60px" }}>
        {/* Page header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 28,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ marginBottom: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--heading)",
                  letterSpacing: "-0.1px",
                }}
              >
                VC Scout
              </span>
            </div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.03em",
                color: "var(--heading)",
                lineHeight: 1.1,
              }}
            >
              Dealflow
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => {
                refreshStartups();
                refreshSignals();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--muted)",
                transition: "all 0.15s ease",
              }}
              title="Refresh list"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0, 0, 0, 0.05)";
                e.currentTarget.style.color = "var(--heading)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--muted)";
              }}
            >
              <svg
                className={refreshingStartups || refreshingSignals ? "animate-spin" : ""}
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </button>
            <SearchBar query={query} setQuery={setQuery} isMac={isMac} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          <div className="dash-tabs" style={{ borderBottom: "none" }}>
            {TABS.map((t) => {
              const badge = TAB_COUNT_BADGE[t.id];
              const count =
                t.id === "all"
                  ? counts.total
                  : counts[t.id as "new" | "approved" | "passed" | "signals"];
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
                  {t.id === "signals" && (
                    <div className="tab-divider" />
                  )}
                  <button
                    data-active={t.id === tab}
                    onClick={() => setTab(t.id)}
                    style={{ paddingBottom: 12 }}
                  >
                    {t.label}
                    <span
                      className="tab-count"
                      style={{
                        background: badge.bg,
                        color: badge.color,
                      }}
                    >
                      {count}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {tab === "signals" ? (
            <button
              onClick={clearAllSignals}
              disabled={clearing || counts.signals === 0}
              style={{
                background: "transparent",
                border: "1px solid var(--border-med)",
                borderRadius: "6px",
                padding: "6px 12px",
                fontSize: "12.5px",
                fontWeight: 500,
                color: "var(--label)",
                cursor: clearing || counts.signals === 0 ? "not-allowed" : "pointer",
                opacity: clearing || counts.signals === 0 ? 0.4 : 1,
                marginBottom: 6,
              }}
            >
              {clearing ? "Clearing..." : "Clear All"}
            </button>
          ) : filtered.length > 0 ? (
            <button
              onClick={() => {
                if (selectedSlugs.size === filtered.length) {
                  setSelectedSlugs(new Set());
                } else {
                  setSelectedSlugs(new Set(filtered.map((s) => s.slug)));
                }
              }}
              style={{
                background: selectedSlugs.size > 0 ? "rgba(0, 122, 255, 0.08)" : "rgba(255, 255, 255, 0.7)",
                border: selectedSlugs.size > 0 ? "1px solid rgba(0, 122, 255, 0.28)" : "1px solid var(--border-med)",
                borderRadius: "8px",
                padding: "5px 12px",
                fontSize: "12.5px",
                fontWeight: selectedSlugs.size > 0 ? 600 : 500,
                color: selectedSlugs.size > 0 ? "var(--accent)" : "var(--label)",
                cursor: "pointer",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                boxShadow: selectedSlugs.size > 0 ? "0 2px 8px rgba(0, 122, 255, 0.12)" : "0 1px 2px rgba(0, 0, 0, 0.03)",
              }}
            >
              <CleanCheckbox
                checked={filtered.length > 0 && selectedSlugs.size === filtered.length}
                onChange={() => {
                  if (selectedSlugs.size === filtered.length) {
                    setSelectedSlugs(new Set());
                  } else {
                    setSelectedSlugs(new Set(filtered.map((s) => s.slug)));
                  }
                }}
              />
              {selectedSlugs.size === filtered.length
                ? "Deselect All"
                : selectedSlugs.size > 0
                ? `Select All (${filtered.length})`
                : "Select All"}
            </button>
          ) : null}
        </div>

        {/* Cards */}
        {tab === "signals" ? (
          <SignalsPanel signals={signals} />
        ) : filtered.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border-med)",
              borderRadius: 10,
              padding: 56,
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 14,
              background: "rgba(255,255,255,0.5)",
            }}
            className="animate-fade-in"
          >
            {query ? "No startups match your search." : "No startups here yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((s, i) => {
              const isPassed = s.status === "passed";
              const enriched = hasEnrichmentData(s);
              const isEnriching = s.enrichment_status === "running";
              const isSelected = selectedSlugs.has(s.slug);

              return (
                <div
                  key={s.slug}
                  data-startup-card
                  className="row-enter"
                  style={{
                    animationDelay: `${Math.min(i * 22, 280)}ms`,
                    border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: 12,
                    background: isPassed ? "rgba(255,255,255,0.45)" : isSelected ? "rgba(0, 122, 255, 0.035)" : "var(--card-bg)",
                    boxShadow: isSelected
                      ? "0 4px 20px rgba(0, 122, 255, 0.12), 0 0 0 1px rgba(0, 122, 255, 0.18) inset"
                      : isPassed
                      ? "none"
                      : "0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(255,255,255,0.6) inset",
                    opacity: isPassed && !isSelected ? 0.62 : 1,
                    transform: isSelected ? "translateY(-1px)" : "translateY(0)",
                    transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                    padding: "18px 20px",
                    position: "relative",
                  }}
                >
                  {/* Card top row: name + badges + actions */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <div style={{ paddingTop: 2, flexShrink: 0 }}>
                      <CleanCheckbox
                        checked={isSelected}
                        onChange={() => {
                          const next = new Set(selectedSlugs);
                          if (isSelected) next.delete(s.slug);
                          else next.add(s.slug);
                          setSelectedSlugs(next);
                        }}
                      />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {/* Name + badges */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          flexWrap: "wrap",
                          marginBottom: 3,
                        }}
                      >
                        <Link
                          href={`/startups/${s.slug}`}
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: "var(--heading)",
                            textDecoration: isPassed ? "line-through" : "none",
                            letterSpacing: "-0.15px",
                          }}
                        >
                          {s.name}
                        </Link>
                        <StatusBadge status={s.status} />
                        {isEnriching && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--accent)",
                              fontWeight: 500,
                              letterSpacing: "0.01em",
                            }}
                            className="live-dot"
                          >
                            enriching…
                          </span>
                        )}
                        {enriched && !isEnriching && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11,
                              fontWeight: 500,
                              color: "var(--success)",
                              background: "rgba(52,199,89,0.08)",
                              border: "1px solid rgba(52,199,89,0.2)",
                              borderRadius: 999,
                              padding: "2px 8px",
                              letterSpacing: "0.01em",
                            }}
                          >
                            <span
                              style={{
                                width: 4,
                                height: 4,
                                borderRadius: 999,
                                background: "var(--success)",
                                flexShrink: 0,
                              }}
                            />
                            enriched
                          </span>
                        )}
                      </div>
                      {/* Website */}
                      {s.website && (
                        <a
                          href={s.website.startsWith("http://") || s.website.startsWith("https://") || s.website.startsWith("//") ? s.website : `https://${s.website}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 12,
                            color: "var(--accent)",
                            textDecoration: "none",
                            opacity: 0.72,
                          }}
                        >
                          {s.website.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                    </div>

                    {/* Actions (raised so menus sit above card content) */}
                    <div style={{ flexShrink: 0, position: "relative", zIndex: 20 }}>
                      <StartupActions
                        slug={s.slug}
                        name={s.name}
                        status={s.status}
                        enrichmentStatus={s.enrichment_status}
                        companyDescription={s.company_description}
                        founders={s.founders}
                      />
                    </div>
                  </div>

                  {/* Card body: one-liner + assessment */}
                  {(s.one_liner || s.assessment) && (
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                      {s.one_liner && (
                        <p
                          style={{
                            fontSize: 13,
                            color: "var(--body)",
                            lineHeight: 1.55,
                            margin: 0,
                          }}
                        >
                          {truncate(s.one_liner, 180)}
                        </p>
                      )}
                      {s.assessment && (
                        <p
                          style={{
                            fontSize: 12,
                            color: "var(--label)",
                            lineHeight: 1.55,
                            margin: 0,
                          }}
                        >
                          {truncate(s.assessment, 220)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Bulk Action Bar (Sleek HUD) */}
      {selectedSlugs.size > 0 && (
        <div
          className="animate-float-up"
          style={{
            position: "fixed",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 500,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "10px 18px",
            background: "rgba(23, 23, 23, 0.88)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: 16,
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.08) inset",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                background: "var(--accent)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: 999,
                boxShadow: "0 2px 8px rgba(0, 122, 255, 0.4)",
              }}
            >
              {selectedSlugs.size}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: "rgba(255, 255, 255, 0.9)", letterSpacing: "-0.1px" }}>
              selected
            </span>
          </div>

          <div style={{ width: 1, height: 22, background: "rgba(255, 255, 255, 0.15)" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="hud-btn"
              onClick={() => handleBatchStatus("approved")}
              disabled={batchBusy !== null}
              style={{
                background: "rgba(52, 199, 89, 0.16)",
                border: "1px solid rgba(52, 199, 89, 0.35)",
                color: "#4cd964",
                boxShadow: "0 2px 10px rgba(52, 199, 89, 0.18)",
                opacity: batchBusy !== null ? 0.5 : 1,
                cursor: batchBusy !== null ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#4cd964", boxShadow: "0 0 8px #4cd964" }} />
              {batchBusy === "approved" ? "Approving…" : "Mark approved"}
            </button>

            <button
              className="hud-btn"
              onClick={() => handleBatchStatus("passed")}
              disabled={batchBusy !== null}
              style={{
                background: "rgba(255, 59, 48, 0.16)",
                border: "1px solid rgba(255, 59, 48, 0.35)",
                color: "#ff453a",
                boxShadow: "0 2px 10px rgba(255, 59, 48, 0.18)",
                opacity: batchBusy !== null ? 0.5 : 1,
                cursor: batchBusy !== null ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#ff453a", boxShadow: "0 0 8px #ff453a" }} />
              {batchBusy === "passed" ? "Passing…" : "Mark passed"}
            </button>

            <button
              className="hud-btn"
              onClick={() => handleBatchStatus("new")}
              disabled={batchBusy !== null}
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                color: "rgba(255, 255, 255, 0.85)",
                opacity: batchBusy !== null ? 0.5 : 1,
                cursor: batchBusy !== null ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "rgba(255, 255, 255, 0.7)" }} />
              {batchBusy === "new" ? "Resetting…" : "Mark new"}
            </button>
          </div>

          <div style={{ width: 1, height: 22, background: "rgba(255, 255, 255, 0.15)" }} />

          <button
            onClick={() => setSelectedSlugs(new Set())}
            disabled={batchBusy !== null}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255, 255, 255, 0.55)",
              fontSize: 13,
              fontWeight: 500,
              cursor: batchBusy !== null ? "not-allowed" : "pointer",
              padding: "5px 10px",
              borderRadius: 8,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.55)";
              e.currentTarget.style.background = "transparent";
            }}
            title="Clear selection"
          >
            Cancel
          </button>
        </div>
      )}
    </main>
  );
}

function CleanCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled && onChange) onChange();
      }}
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        border: checked ? "1px solid var(--accent)" : "1.5px solid var(--border-med)",
        background: checked ? "var(--accent)" : "rgba(255, 255, 255, 0.9)",
        boxShadow: checked
          ? "0 2px 8px rgba(0, 122, 255, 0.35)"
          : "0 1px 2px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {checked && (
        <svg
          className="animate-check"
          width="11"
          height="9"
          viewBox="0 0 11 9"
          fill="none"
          style={{
            stroke: "#ffffff",
            strokeWidth: 2.2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }}
        >
          <path d="M1 4.5L4 7.5L10 1.5" />
        </svg>
      )}
    </div>
  );
}

function SearchBar({
  query,
  setQuery,
  isMac,
}: {
  query: string;
  setQuery: (v: string) => void;
  isMac: boolean;
}) {
  return (
    <div
      className="glass-input"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 38,
        padding: "0 12px",
        minWidth: 240,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--muted)"
        strokeWidth="2.2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search startups…"
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 13,
          color: "var(--body)",
          flex: 1,
          minWidth: 0,
        }}
      />
      <kbd
        style={{
          fontSize: 10.5,
          color: "var(--muted)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          padding: "1px 5px",
          background: "rgba(255,255,255,0.5)",
          fontFamily: "inherit",
        }}
      >
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </div>
  );
}
