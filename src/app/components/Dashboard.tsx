"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, SlidersHorizontal, Zap } from "lucide-react";
import type { Startup } from "../../lib/supabase";
import { hasEnrichmentData, isStaleRunning } from "../../lib/enrichment";
import { sortStartups } from "../../lib/sortStartups";
import { readSession, writeSession } from "../../lib/persistedState";
import { queueWrite } from "../../lib/writeQueue";
import { useLiveStartups } from "../hooks/useLiveStartups";
import StatusBadge from "./StatusBadge";
import OutreachBadges from "./OutreachBadges";
import StartupActions from "./StartupActions";
import StartupPanel from "./StartupPanel";
import CommandPalette from "./CommandPalette";
import SpeedReview from "./SpeedReview";
import { useToast } from "./Toast";

type Tab = "all" | "new" | "approved" | "passed";
type ChannelFilter = "all" | "not_contacted" | "contacted" | "replied";
type StealthFilter = "all" | "stealth" | "public";
type FollowupFilter = "all" | "none" | "any" | "stale";

const CHANNEL_FILTER_OPTIONS: { value: ChannelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "not_contacted", label: "Not contacted" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
];

// "stale" = followed up at least once, but the last one was over STALE_FOLLOWUP_DAYS
// ago — the pile that quietly goes cold, which a plain any/none split hides.
const STALE_FOLLOWUP_DAYS = 21;

const FOLLOWUP_FILTER_OPTIONS: { value: FollowupFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "none", label: "Never" },
  { value: "any", label: "Followed up" },
  { value: "stale", label: `Stale (${STALE_FOLLOWUP_DAYS}d+)` },
];

const STEALTH_FILTER_OPTIONS: { value: StealthFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "public", label: "Not stealth" },
  { value: "stealth", label: "Stealth" },
];

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "approved", label: "Approved" },
  { id: "passed", label: "Passed" },
];

const TAB_COUNT_BADGE: Record<Tab, { bg: string; color: string }> = {
  all: { bg: "rgba(0, 0, 0, 0.1)", color: "var(--heading)" },
  new: { bg: "var(--accent)", color: "#fff" },
  approved: { bg: "var(--success)", color: "#fff" },
  passed: { bg: "var(--danger)", color: "#fff" },
};

function truncate(text: string | null, n: number): string {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).trimEnd() + "…" : text;
}

type DashUiState = {
  tab: Tab;
  query: string;
  stealthFilter: StealthFilter;
  linkedinFilter: ChannelFilter;
  emailFilter: ChannelFilter;
  followupFilter: FollowupFilter;
};

const DEFAULT_FILTERS: Pick<
  DashUiState,
  "stealthFilter" | "linkedinFilter" | "emailFilter" | "followupFilter"
> = {
  stealthFilter: "all",
  linkedinFilter: "all",
  emailFilter: "all",
  followupFilter: "all",
};

function matchesFollowupFilter(s: Startup, filter: FollowupFilter): boolean {
  const count = s.followup_count ?? 0;
  if (filter === "all") return true;
  if (filter === "none") return count === 0;
  if (filter === "any") return count > 0;
  // stale
  if (count === 0) return false;
  if (!s.last_followup_at) return true;
  const last = new Date(s.last_followup_at).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > STALE_FOLLOWUP_DAYS * 86400000;
}

const DASH_UI_KEY = "dealflow-ui";

export default function Dashboard({ initial }: { initial: Startup[] }) {
  const {
    startups,
    refresh: refreshStartups,
    refreshing: refreshingStartups,
    updateLocal,
  } = useLiveStartups(initial);
  const savedUi = readSession<Partial<DashUiState>>(DASH_UI_KEY, {});
  const [tab, setTab] = useState<Tab>((savedUi.tab as Tab) ?? "all");
  const [query, setQuery] = useState(savedUi.query ?? "");
  const [stealthFilter, setStealthFilter] = useState<StealthFilter>(
    savedUi.stealthFilter ?? DEFAULT_FILTERS.stealthFilter
  );
  const [linkedinFilter, setLinkedinFilter] = useState<ChannelFilter>(
    savedUi.linkedinFilter ?? DEFAULT_FILTERS.linkedinFilter
  );
  const [emailFilter, setEmailFilter] = useState<ChannelFilter>(
    savedUi.emailFilter ?? DEFAULT_FILTERS.emailFilter
  );
  const [followupFilter, setFollowupFilter] = useState<FollowupFilter>(
    savedUi.followupFilter ?? DEFAULT_FILTERS.followupFilter
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [isMac, setIsMac] = useState(true);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [panelSlug, setPanelSlug] = useState<string | null>(null);
  // Frozen snapshot of slugs from `filtered` at the moment Speed Review opens — the
  // current tab/search/filters, so it's naturally scoped per-tab without separate
  // per-tab entry points. Doesn't reshuffle mid-review even as statuses change.
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  const { showUndoToast } = useToast();

  // Undo restores each row to its OWN previous status, not a single shared one —
  // a mixed-status selection (e.g. in the "All" tab) batch-approved together can't
  // be undone via the batch endpoint, which only ever sets one status for everyone.
  async function undoBatchStatus(prevStatuses: Map<string, Startup["status"] | undefined>) {
    prevStatuses.forEach((prevStatus, slug) => {
      if (prevStatus) updateLocal(slug, { status: prevStatus });
    });
    await Promise.all(
      Array.from(prevStatuses.entries()).map(([slug, prevStatus]) => {
        if (!prevStatus) return Promise.resolve();
        return queueWrite(slug, async () => {
          const res = await fetch(`/api/startup/${slug}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: prevStatus }),
          });
          if (!res.ok) throw new Error("undo failed");
        }).catch((e) => console.error(`undo failed for ${slug}:`, e));
      })
    );
  }

  async function handleBatchStatus(status: "new" | "approved" | "passed") {
    if (selectedSlugs.size === 0) return;
    const slugs = Array.from(selectedSlugs);
    const prevStatuses = new Map(
      slugs.map((slug) => [slug, startups.find((s) => s.slug === slug)?.status])
    );
    slugs.forEach((slug) => updateLocal(slug, { status }));
    setSelectedSlugs(new Set());
    setBatchBusy(status);
    try {
      await queueWrite("batch", async () => {
        const res = await fetch("/api/startups", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slugs, status }),
        });
        if (!res.ok) throw new Error("batch update failed");
      });
      showUndoToast(
        `${slugs.length} startup${slugs.length === 1 ? "" : "s"} marked ${status}`,
        () => undoBatchStatus(prevStatuses)
      );
    } catch (e) {
      console.error("Batch update failed:", e);
      prevStatuses.forEach((prevStatus, slug) => {
        if (prevStatus) updateLocal(slug, { status: prevStatus });
      });
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
  }, []);

  useEffect(() => {
    writeSession(DASH_UI_KEY, { tab, query, stealthFilter, linkedinFilter, emailFilter, followupFilter });
  }, [tab, query, stealthFilter, linkedinFilter, emailFilter, followupFilter]);

  useEffect(() => {
    if (!filtersOpen) return;
    const onClick = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [filtersOpen]);

  const activeFilterCount =
    (stealthFilter !== "all" ? 1 : 0) +
    (linkedinFilter !== "all" ? 1 : 0) +
    (emailFilter !== "all" ? 1 : 0) +
    (followupFilter !== "all" ? 1 : 0);

  function applyNeedsEmailPreset() {
    setStealthFilter("public");
    setEmailFilter("not_contacted");
  }

  function clearFilters() {
    setStealthFilter(DEFAULT_FILTERS.stealthFilter);
    setLinkedinFilter(DEFAULT_FILTERS.linkedinFilter);
    setEmailFilter(DEFAULT_FILTERS.emailFilter);
    setFollowupFilter(DEFAULT_FILTERS.followupFilter);
  }

  function clearAllFilters() {
    clearFilters();
    setQuery("");
  }

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
        stealthFilter === "all" ? true : stealthFilter === "stealth" ? s.stealth : !s.stealth
      )
      .filter((s) => (linkedinFilter === "all" ? true : s.linkedin_status === linkedinFilter))
      .filter((s) => (emailFilter === "all" ? true : s.email_status === emailFilter))
      .filter((s) => matchesFollowupFilter(s, followupFilter))
      .filter((s) =>
        q
          ? s.name.toLowerCase().includes(q) ||
            (s.one_liner ?? "").toLowerCase().includes(q) ||
            (s.assessment ?? "").toLowerCase().includes(q)
          : true
      );
    return sortStartups(rows);
  }, [startups, tab, query, stealthFilter, linkedinFilter, emailFilter, followupFilter]);

  const panelStartup = panelSlug ? startups.find((s) => s.slug === panelSlug) ?? null : null;

  return (
    <main style={{ minHeight: "100vh", background: "var(--page-bg)", color: "var(--body)" }}>
      <CommandPalette startups={startups} />
      {panelStartup && (
        <StartupPanel
          startup={panelStartup}
          onClose={() => setPanelSlug(null)}
          onUpdate={(partial) => updateLocal(panelStartup.slug, partial)}
        />
      )}
      {reviewQueue && (
        <SpeedReview
          startups={startups}
          queueSlugs={reviewQueue}
          onUpdate={updateLocal}
          onClose={() => setReviewQueue(null)}
        />
      )}

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
            <Link
              href="/chat"
              prefetch
              className="dash-nav-link"
              title="Agent Chat"
            >
              <MessageCircle size={15} strokeWidth={2.2} />
              Agent Chat
            </Link>
            <button
              onClick={() => {
                refreshStartups();
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
                className={refreshingStartups ? "animate-spin" : ""}
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
                  : counts[t.id as "new" | "approved" | "passed"];
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
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
          {filtered.length > 0 ? (
            <button
              onClick={() => setReviewQueue(filtered.map((s) => s.slug))}
              title="Speed review — go through this view one card at a time"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid rgba(0,122,255,0.3)",
                background: "rgba(0,122,255,0.08)",
                color: "var(--accent)",
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                marginBottom: 6,
              }}
            >
              <Zap size={13} strokeWidth={2.2} />
              Speed Review
            </button>
          ) : null}
        </div>

        {/* Toolbar: filters (+ count) on the left, search on the right */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div ref={filtersRef} style={{ position: "relative" }}>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                title="Filter by outreach status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: activeFilterCount > 0 ? "1px solid rgba(0,122,255,0.3)" : "1px solid var(--border)",
                  background: activeFilterCount > 0 ? "rgba(0,122,255,0.08)" : "rgba(255,255,255,0.7)",
                  color: activeFilterCount > 0 ? "var(--accent)" : "var(--label)",
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <SlidersHorizontal size={13} strokeWidth={2.2} />
                Filters
                {activeFilterCount > 0 && (
                  <span
                    style={{
                      background: "var(--accent)",
                      color: "#fff",
                      fontSize: 10.5,
                      fontWeight: 600,
                      borderRadius: 999,
                      minWidth: 15,
                      height: 15,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 3px",
                    }}
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {filtersOpen && (
                <div
                  className="menu-pop animate-fade-in"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 38,
                    width: 240,
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
                    padding: 12,
                    zIndex: 50,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={applyNeedsEmailPreset}
                    style={{
                      textAlign: "left",
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: "var(--accent)",
                      background: "rgba(0,122,255,0.06)",
                      border: "1px solid rgba(0,122,255,0.18)",
                      borderRadius: 6,
                      padding: "6px 9px",
                      cursor: "pointer",
                    }}
                  >
                    Needs email (not stealth, not yet emailed)
                  </button>

                  <FilterGroup
                    label="Stealth"
                    value={stealthFilter}
                    options={STEALTH_FILTER_OPTIONS}
                    onChange={setStealthFilter}
                  />
                  <FilterGroup
                    label="LinkedIn"
                    value={linkedinFilter}
                    options={CHANNEL_FILTER_OPTIONS}
                    onChange={setLinkedinFilter}
                  />
                  <FilterGroup
                    label="Email"
                    value={emailFilter}
                    options={CHANNEL_FILTER_OPTIONS}
                    onChange={setEmailFilter}
                  />
                  <FilterGroup
                    label="Follow-ups"
                    value={followupFilter}
                    options={FOLLOWUP_FILTER_OPTIONS}
                    onChange={setFollowupFilter}
                  />

                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      style={{
                        textAlign: "left",
                        fontSize: 12,
                        color: "var(--muted)",
                        background: "transparent",
                        border: "none",
                        padding: "2px 0 0",
                        cursor: "pointer",
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
              {filtered.length} shown
            </span>

            {(activeFilterCount > 0 || query.trim() !== "") && (
              <button
                type="button"
                onClick={clearAllFilters}
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--accent)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Remove filters
              </button>
            )}
          </div>

          <SearchBar query={query} setQuery={setQuery} isMac={isMac} />
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
              const isEnriching = s.enrichment_status === "running" && !isStaleRunning(s);
              const isSelected = selectedSlugs.has(s.slug);

              return (
                <div
                  key={s.slug}
                  data-startup-card
                  className="row-enter"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest("a, button, input, label, [data-no-nav]")) return;
                    setPanelSlug(s.slug);
                  }}
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
                    cursor: enriched ? "pointer" : "default",
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
                    <div style={{ paddingTop: 2, flexShrink: 0 }} data-no-nav>
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
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                            e.preventDefault();
                            setPanelSlug(s.slug);
                          }}
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
                        <OutreachBadges
                          stealth={s.stealth}
                          linkedinStatus={s.linkedin_status}
                          emailStatus={s.email_status}
                          followupCount={s.followup_count}
                          lastFollowupAt={s.last_followup_at}
                        />
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
                    <div style={{ flexShrink: 0, position: "relative", zIndex: 20 }} data-no-nav>
                      <StartupActions
                        slug={s.slug}
                        name={s.name}
                        status={s.status}
                        enrichmentStatus={s.enrichment_status}
                        enrichmentUpdatedAt={s.updated_at}
                        companyDescription={s.company_description}
                        founders={s.founders}
                        stealth={s.stealth}
                        linkedinStatus={s.linkedin_status}
                        emailStatus={s.email_status}
                        followupCount={s.followup_count}
                        lastFollowupAt={s.last_followup_at}
                        onUpdate={(partial) => updateLocal(s.slug, partial)}
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
            background: "var(--card-bg)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.18), 0 2px 10px rgba(0, 0, 0, 0.06)",
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
            <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--heading)", letterSpacing: "-0.1px" }}>
              selected
            </span>
          </div>

          <div style={{ width: 1, height: 22, background: "var(--border)" }} />

          <button
            className="hud-btn"
            onClick={() => {
              if (selectedSlugs.size === filtered.length) {
                setSelectedSlugs(new Set());
              } else {
                setSelectedSlugs(new Set(filtered.map((s) => s.slug)));
              }
            }}
            style={{
              background: "rgba(0, 122, 255, 0.08)",
              border: "1px solid rgba(0, 122, 255, 0.25)",
              color: "var(--accent)",
            }}
          >
            {selectedSlugs.size === filtered.length ? "Deselect All" : `Select All (${filtered.length})`}
          </button>

          <div style={{ width: 1, height: 22, background: "var(--border)" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="hud-btn"
              onClick={() => handleBatchStatus("approved")}
              disabled={batchBusy !== null}
              style={{
                background: "rgba(52, 199, 89, 0.12)",
                border: "1px solid rgba(52, 199, 89, 0.3)",
                color: "#1e9e4a",
                opacity: batchBusy !== null ? 0.5 : 1,
                cursor: batchBusy !== null ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#1e9e4a" }} />
              {batchBusy === "approved" ? "Approving…" : "Mark approved"}
            </button>

            <button
              className="hud-btn"
              onClick={() => handleBatchStatus("passed")}
              disabled={batchBusy !== null}
              style={{
                background: "rgba(255, 59, 48, 0.1)",
                border: "1px solid rgba(255, 59, 48, 0.3)",
                color: "#d9291f",
                opacity: batchBusy !== null ? 0.5 : 1,
                cursor: batchBusy !== null ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#d9291f" }} />
              {batchBusy === "passed" ? "Passing…" : "Mark passed"}
            </button>

            <button
              className="hud-btn"
              onClick={() => handleBatchStatus("new")}
              disabled={batchBusy !== null}
              style={{
                background: "rgba(0, 0, 0, 0.04)",
                border: "1px solid var(--border-med)",
                color: "var(--label)",
                opacity: batchBusy !== null ? 0.5 : 1,
                cursor: batchBusy !== null ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--label)" }} />
              {batchBusy === "new" ? "Resetting…" : "Mark new"}
            </button>
          </div>

          <div style={{ width: 1, height: 22, background: "var(--border)" }} />

          <button
            onClick={() => setSelectedSlugs(new Set())}
            disabled={batchBusy !== null}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              fontSize: 13,
              fontWeight: 500,
              cursor: batchBusy !== null ? "not-allowed" : "pointer",
              padding: "5px 10px",
              borderRadius: 8,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--heading)";
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted)";
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

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 500,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                padding: "4px 9px",
                borderRadius: 999,
                border: active ? "1px solid rgba(0,122,255,0.3)" : "1px solid var(--border)",
                background: active ? "rgba(0,122,255,0.08)" : "transparent",
                color: active ? "var(--accent)" : "var(--label)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
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
