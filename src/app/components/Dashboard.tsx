"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Startup } from "../../lib/supabase";
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
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        zIndex: 200,
      }}
      className="animate-fade-in"
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 13,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--blue)",
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          VC Scout
        </div>
        <div style={{ fontSize: 34, color: "var(--black)", letterSpacing: "-0.02em" }}>
          Dealflow Agent
        </div>
      </div>
      <div
        style={{
          position: "relative",
          width: 220,
          height: 4,
          borderRadius: 999,
          background: "#f1f5f9",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            borderRadius: 999,
            background: "linear-gradient(90deg, #0066ff, #22c55e)",
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
    return startups
      .filter((s) => (tab === "all" ? true : s.status === tab))
      .filter((s) =>
        q
          ? s.name.toLowerCase().includes(q) ||
            (s.one_liner ?? "").toLowerCase().includes(q) ||
            (s.assessment ?? "").toLowerCase().includes(q)
          : true
      );
  }, [startups, tab, query]);

  return (
    <main style={{ minHeight: "100vh", background: "var(--page)", color: "var(--black)" }}>
      {booting && <HeroLoader />}
      <CommandPalette startups={startups} />

      {/* Nav */}
      <nav
        style={{
          height: 58,
          background: "#fff",
          color: "var(--black)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          position: "sticky",
          top: 0,
          zIndex: 50,
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>VC Scout</span>
          <span
            title={mode === "realtime" ? "Live" : "Auto-refreshing"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--gray)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "2px 8px",
              background: "#f8fafc",
            }}
          >
            <span
              className="live-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: mode === "realtime" ? "#22c55e" : "#f59e0b",
              }}
            />
            {mode === "realtime" ? "live" : "syncing"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 13, color: "var(--gray)" }}>
          <span style={{ color: "var(--blue)", fontWeight: 500 }}>{counts.new} new</span>
          <span style={{ color: "var(--green)", fontWeight: 500 }}>{counts.approved} approved</span>
          <span style={{ color: "var(--red)", fontWeight: 500 }}>{counts.passed} passed</span>
        </div>
      </nav>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px" }}>
        {/* Header + search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 24,
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ fontSize: 32, lineHeight: "40px", margin: 0, letterSpacing: "-0.02em" }}>
            Dealflow
          </h1>
          <SearchBar query={query} setQuery={setQuery} isMac={isMac} />
        </div>

        {/* Stat cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <StatCard label="Total" value={counts.total} tint="#fff" />
          <StatCard label="New" value={counts.new} accent="var(--blue)" tint="#eff6ff" />
          <StatCard label="Approved" value={counts.approved} accent="var(--green)" tint="#ecfdf3" />
          <StatCard label="Passed" value={counts.passed} accent="var(--red)" tint="#fef2f2" />
        </div>

        {/* Tabs */}
        <div className="seg" style={{ marginBottom: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              data-active={t.id === tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border-med)",
              borderRadius: 14,
              padding: 56,
              textAlign: "center",
              color: "var(--gray-light)",
              fontSize: 14,
              marginTop: 16,
              background: "#fff",
            }}
            className="animate-fade-in"
          >
            {query ? "No startups match your search." : "No startups here yet."}
          </div>
        ) : (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((s, i) => {
              const isPassed = s.status === "passed";
              return (
                <div
                  key={s.slug}
                  className="row-enter"
                  style={{
                    animationDelay: `${Math.min(i * 25, 300)}ms`,
                    display: "grid",
                    gridTemplateColumns: "1.5fr 1.9fr auto",
                    gap: 16,
                    alignItems: "center",
                    padding: 16,
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    background: isPassed ? "#f8fafc" : "#fff",
                    boxShadow: isPassed
                      ? "none"
                      : "0 1px 3px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(255,255,255,0.8) inset",
                    opacity: isPassed ? 0.72 : 1,
                    filter: isPassed ? "grayscale(0.2)" : "none",
                    transition: "opacity 0.2s ease, background 0.2s ease",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
                    >
                      <Link
                        href={`/startups/${s.slug}`}
                        style={{
                          fontSize: 15,
                          color: "var(--black)",
                          textDecoration: isPassed ? "line-through" : "none",
                        }}
                      >
                        {s.name}
                      </Link>
                      <StatusBadge status={s.status} />
                    </div>
                    {s.website && (
                      <a
                        href={s.website}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: "var(--blue)", textDecoration: "none" }}
                      >
                        {s.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--black)" }}>
                      {truncate(s.one_liner, 90)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--gray-light)", marginTop: 3 }}>
                      {truncate(s.assessment, 110)}
                    </div>
                  </div>
                  <StartupActions
                    slug={s.slug}
                    name={s.name}
                    status={s.status}
                    enrichmentStatus={s.enrichment_status}
                    companyDescription={s.company_description}
                    founders={s.founders}
                  />
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
        height: 42,
        padding: "0 12px",
        borderRadius: 12,
        minWidth: 280,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9C988F" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search startups..."
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 14,
          color: "var(--black)",
          flex: 1,
          minWidth: 0,
        }}
      />
      <kbd
        style={{
          fontSize: 11,
          color: "#9C988F",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 6,
          padding: "1px 6px",
          background: "rgba(255,255,255,0.6)",
          fontFamily: "inherit",
        }}
      >
        {isMac ? "⌘" : "Ctrl"} K
      </kbd>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = "var(--black)",
  tint = "#fff",
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
        borderRadius: 14,
        padding: "16px 18px",
        background: tint,
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--gray)", marginBottom: 6, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, color: accent, lineHeight: 1, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
