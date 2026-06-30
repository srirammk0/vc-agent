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

type Tab = "all" | "new" | "approved" | "passed";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "approved", label: "Approved" },
  { id: "passed", label: "Passed" },
];

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

export default function Dashboard({ initial }: { initial: Startup[] }) {
  const { startups, mode } = useLiveStartups(initial);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [booting, setBooting] = useState(true);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(
      typeof navigator !== "undefined" &&
        /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    );
    const t = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(t);
  }, []);

  const counts = useMemo(
    () => ({
      total: startups.length,
      new: startups.filter((s) => s.status === "new").length,
      approved: startups.filter((s) => s.status === "approved").length,
      passed: startups.filter((s) => s.status === "passed").length,
    }),
    [startups]
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

  return (
    <main style={{ minHeight: "100vh", background: "var(--page-bg)", color: "var(--body)" }}>
      {booting && <HeroLoader />}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
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
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "var(--label)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "2px 7px",
                  background: "rgba(255,255,255,0.6)",
                }}
              >
                <span
                  className="live-dot"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: mode === "realtime" ? "var(--success)" : "var(--warning)",
                    flexShrink: 0,
                  }}
                />
                {mode === "realtime" ? "live" : "syncing"}
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
          <SearchBar query={query} setQuery={setQuery} isMac={isMac} />
        </div>

        {/* Stat cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 10,
            marginBottom: 20,
          }}
        >
          <StatCard label="Total" value={counts.total} />
          <StatCard label="New" value={counts.new} accent="var(--accent)" tint="rgba(0,122,255,0.05)" />
          <StatCard label="Approved" value={counts.approved} accent="var(--success)" tint="rgba(52,199,89,0.06)" />
          <StatCard label="Passed" value={counts.passed} accent="var(--danger)" tint="rgba(255,59,48,0.05)" />
        </div>

        {/* Tabs */}
        <div className="seg-tabs" style={{ marginBottom: 16 }}>
          {TABS.map((t) => (
            <button key={t.id} data-active={t.id === tab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Cards */}
        {filtered.length === 0 ? (
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

              return (
                <div
                  key={s.slug}
                  className="row-enter"
                  style={{
                    animationDelay: `${Math.min(i * 22, 280)}ms`,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    background: isPassed ? "rgba(255,255,255,0.45)" : "var(--card-bg)",
                    boxShadow: isPassed
                      ? "none"
                      : "0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(255,255,255,0.6) inset",
                    opacity: isPassed ? 0.62 : 1,
                    transition: "opacity 0.2s ease",
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
                          href={s.website}
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

                    {/* Actions (three-dot + enrich) */}
                    <div style={{ flexShrink: 0, position: "relative", zIndex: 1 }}>
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
    </main>
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
        padding: "0 11px",
        borderRadius: 7,
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

function StatCard({
  label,
  value,
  accent = "var(--heading)",
  tint = "var(--card-bg)",
}: {
  label: string;
  value: number;
  accent?: string;
  tint?: string;
}) {
  return (
    <div
      className="animate-fade-up"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
        background: tint,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--label)",
          marginBottom: 6,
          fontWeight: 500,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          color: accent,
          lineHeight: 1,
          fontWeight: 600,
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </div>
    </div>
  );
}
