"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Section,
  Spinner,
  Stack,
  Tab,
  TabList,
  Text,
  TextInput,
  Toolbar,
} from "@astryxdesign/core";
import type { Startup } from "../../lib/supabase";
import { hasEnrichmentData } from "../../lib/enrichment";
import { sortStartups } from "../../lib/sortStartups";
import { useLiveStartups } from "../hooks/useLiveStartups";
import StatusBadge from "./StatusBadge";
import StartupActions from "./StartupActions";
import CommandPalette from "./CommandPalette";
import AgentChat from "./AgentChat";

type Tab = "all" | "new" | "approved" | "passed" | "chat";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "approved", label: "Approved" },
  { id: "passed", label: "Passed" },
  { id: "chat", label: "Agent Chat" },
];

// Plain native checkbox for row selection — astryx's CheckboxInput (0.1.4)
// emits a client-only caret-color style that mismatches SSR output on every
// row; this sidesteps that hydration warning for this high-frequency spot.
function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="row-checkbox"
    />
  );
}

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
        background: "var(--color-background-body)",
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
        <Text type="supporting" size="xsm" display="block">
          VC Scout
        </Text>
        <Text type="display-3" size="2xl" display="block">
          Dealflow Agent
        </Text>
      </div>
      <Spinner size="lg" />
    </div>
  );
}

export default function Dashboard({ initial }: { initial: Startup[] }) {
  const { startups, refresh: refreshStartups, refreshing } = useLiveStartups(initial);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [booting, setBooting] = useState(true);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<string | null>(null);

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
    }),
    [startups]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = startups
      .filter((s) => (tab === "all" || tab === "chat" ? true : s.status === tab))
      .filter((s) =>
        q
          ? s.name.toLowerCase().includes(q) ||
            (s.one_liner ?? "").toLowerCase().includes(q) ||
            (s.assessment ?? "").toLowerCase().includes(q)
          : true
      );
    return sortStartups(rows);
  }, [startups, tab, query]);

  const showLoader = booting || refreshing;

  return (
    <main style={{ minHeight: "100vh", background: "var(--color-background-body)", color: "var(--color-text-primary)" }}>
      {showLoader && <HeroLoader />}
      <CommandPalette startups={startups} />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 60px" }}>
        <Stack direction="horizontal" hAlign="between" vAlign="end" gap={4} style={{ marginBottom: 28, flexWrap: "wrap" }}>
          <Stack direction="vertical" gap={1}>
            <Text type="supporting" size="xsm">VC Scout</Text>
            <Text type="display-2" size="2xl">Dealflow</Text>
          </Stack>
          <Stack direction="horizontal" gap={2} vAlign="center">
            <Button
              label="Refresh list"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />}
              clickAction={() => refreshStartups()}
            />
            <TextInput
              label="Search startups"
              isLabelHidden
              value={query}
              onChange={setQuery}
              placeholder="Search startups…"
              startIcon={<Search size={13} />}
              hasClear
              size="sm"
              width={240}
            />
          </Stack>
        </Stack>

        <Stack direction="horizontal" hAlign="between" vAlign="center" gap={2} style={{ marginBottom: 16 }}>
          <TabList value={tab} onChange={(v) => setTab(v as Tab)} hasDivider size="sm">
            {TABS.map((t) => (
              <Tab
                key={t.id}
                value={t.id}
                label={t.label}
                endContent={
                  t.id === "chat" ? undefined : (
                    <Badge
                      label={t.id === "all" ? counts.total : counts[t.id as "new" | "approved" | "passed"]}
                      variant={t.id === "new" ? "info" : t.id === "approved" ? "success" : t.id === "passed" ? "error" : "neutral"}
                    />
                  )
                }
              />
            ))}
          </TabList>
          {tab !== "chat" && filtered.length > 0 && (
            <Button
              label={
                selectedSlugs.size === filtered.length
                  ? "Deselect all"
                  : selectedSlugs.size > 0
                  ? `Select all (${filtered.length})`
                  : "Select all"
              }
              variant={selectedSlugs.size > 0 ? "primary" : "secondary"}
              size="sm"
              clickAction={() => {
                if (selectedSlugs.size === filtered.length) setSelectedSlugs(new Set());
                else setSelectedSlugs(new Set(filtered.map((s) => s.slug)));
              }}
            />
          )}
        </Stack>

        {tab === "chat" ? (
          <AgentChat />
        ) : filtered.length === 0 ? (
          <Section variant="muted">
            <Text type="body" size="sm" color="secondary" display="block" justify="center">
              {query ? "No startups match your search." : "No startups here yet."}
            </Text>
          </Section>
        ) : (
          <Stack direction="vertical" gap={2}>
            {filtered.map((s, i) => {
              const isPassed = s.status === "passed";
              const enriched = hasEnrichmentData(s);
              const isEnriching = s.enrichment_status === "running";
              const isSelected = selectedSlugs.has(s.slug);

              return (
                <Card
                  key={s.slug}
                  padding={0}
                  variant={isSelected ? "blue" : "default"}
                  className="row-enter"
                  style={{
                    animationDelay: `${Math.min(i * 22, 280)}ms`,
                    opacity: isPassed && !isSelected ? 0.62 : 1,
                  }}
                >
                  <Stack direction="horizontal" gap={3} vAlign="start" style={{ padding: "16px 18px" }}>
                    <div style={{ paddingTop: 3 }}>
                      <RowCheckbox
                        label={`Select ${s.name}`}
                        checked={isSelected}
                        onChange={() => {
                          const next = new Set(selectedSlugs);
                          if (isSelected) next.delete(s.slug);
                          else next.add(s.slug);
                          setSelectedSlugs(next);
                        }}
                      />
                    </div>

                    <Stack direction="vertical" gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="horizontal" gap={2} vAlign="center" style={{ flexWrap: "wrap" }}>
                        <Link
                          href={`/startups/${s.slug}`}
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: "var(--color-text-primary)",
                            textDecoration: isPassed ? "line-through" : "none",
                          }}
                        >
                          {s.name}
                        </Link>
                        <StatusBadge status={s.status} />
                        {isEnriching && (
                          <Text type="supporting" size="xsm" color="accent">enriching…</Text>
                        )}
                        {enriched && !isEnriching && <Badge label="enriched" variant="success" />}
                      </Stack>

                      {s.website && (
                        <a
                          href={s.website.startsWith("http") ? s.website : `https://${s.website}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 12, color: "var(--color-accent)", textDecoration: "none", opacity: 0.75 }}
                        >
                          {s.website.replace(/^https?:\/\//, "")}
                        </a>
                      )}

                      {(s.one_liner || s.assessment) && (
                        <Stack direction="vertical" gap={1}>
                          {s.one_liner && (
                            <Text type="body" size="sm">{truncate(s.one_liner, 180)}</Text>
                          )}
                          {s.assessment && (
                            <Text type="body" size="xsm" color="secondary">{truncate(s.assessment, 220)}</Text>
                          )}
                        </Stack>
                      )}
                    </Stack>

                    <StartupActions
                      slug={s.slug}
                      name={s.name}
                      status={s.status}
                      enrichmentStatus={s.enrichment_status}
                      companyDescription={s.company_description}
                      founders={s.founders}
                    />
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        )}
      </div>

      {selectedSlugs.size > 0 && (
        <div
          className="animate-float-up"
          style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", zIndex: 500 }}
        >
          <Card padding={1}>
            <Toolbar
              label="Bulk actions"
              size="sm"
              startContent={
                <Stack direction="horizontal" gap={2} vAlign="center">
                  <Badge label={selectedSlugs.size} variant="info" />
                  <Text type="label" size="sm">selected</Text>
                </Stack>
              }
              endContent={
                <Stack direction="horizontal" gap={2} vAlign="center">
                  <Button
                    label={batchBusy === "approved" ? "Approving…" : "Mark approved"}
                    variant="secondary"
                    size="sm"
                    isDisabled={batchBusy !== null}
                    clickAction={() => handleBatchStatus("approved")}
                  />
                  <Button
                    label={batchBusy === "passed" ? "Passing…" : "Mark passed"}
                    variant="destructive"
                    size="sm"
                    isDisabled={batchBusy !== null}
                    clickAction={() => handleBatchStatus("passed")}
                  />
                  <Button
                    label={batchBusy === "new" ? "Resetting…" : "Mark new"}
                    variant="ghost"
                    size="sm"
                    isDisabled={batchBusy !== null}
                    clickAction={() => handleBatchStatus("new")}
                  />
                  <Button
                    label="Cancel"
                    variant="ghost"
                    size="sm"
                    isDisabled={batchBusy !== null}
                    clickAction={() => setSelectedSlugs(new Set())}
                  />
                </Stack>
              }
            />
          </Card>
        </div>
      )}
    </main>
  );
}
