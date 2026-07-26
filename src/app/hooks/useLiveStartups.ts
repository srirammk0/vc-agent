"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "../../lib/supabaseBrowser";
import { sortStartups } from "../../lib/sortStartups";
import type { Startup } from "../../lib/supabase";

type Mode = "connecting" | "realtime" | "polling";

/**
 * Was 4000ms. A dashboard tab left open overnight, polling the whole table every 4
 * seconds, is tens of GB of Supabase egress a month on its own — the main reason
 * this project blew past its quota. 30s is still comfortably "live" for a feed that
 * only moves when a human clicks something or an agent sweep lands, and this poll is
 * just the fallback for when realtime isn't configured at all.
 */
const POLL_INTERVAL_MS = 30000;

/**
 * Single initial load (from server props), then live updates.
 * Uses Supabase realtime when the public anon key is configured, otherwise
 * falls back to lightweight polling so the dashboard still stays fresh.
 */
export function useLiveStartups(initial: Startup[]) {
  const [startups, setStartups] = useState<Startup[]>(() => sortStartups(initial));
  const [mode, setMode] = useState<Mode>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef<Map<string, Startup>>(
    new Map(sortStartups(initial).map((s) => [s.slug, s]))
  );
  /** Slugs whose full row (founders, company_description, …) has been fetched. */
  const hydratedRef = useRef<Set<string>>(new Set());

  function commit() {
    setStartups(sortStartups(Array.from(mapRef.current.values())));
  }

  /**
   * Merge list rows in rather than replacing the map wholesale — the list query no
   * longer selects every column, so overwriting would strip the enrichment fields
   * off any row hydrate() had already filled in.
   */
  function mergeRows(rows: Startup[]) {
    const next = new Map<string, Startup>();
    for (const row of rows) {
      const existing = mapRef.current.get(row.slug);
      next.set(row.slug, existing ? { ...existing, ...row } : row);
    }
    mapRef.current = next;
    for (const slug of Array.from(hydratedRef.current)) {
      if (!next.has(slug)) hydratedRef.current.delete(slug);
    }
    commit();
  }

  async function fetchList(): Promise<Startup[] | null> {
    try {
      const res = await fetch("/api/startups");
      if (!res.ok) return null;
      const { startups: rows } = await res.json();
      return Array.isArray(rows) ? (rows as Startup[]) : null;
    } catch {
      return null;
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const rows = await fetchList();
      if (rows) mergeRows(rows);
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Fetch the full row for one startup, on demand.
   *
   * The list only carries STARTUP_LIST_COLUMNS, so anything rendering enrichment data
   * (the detail panel, Speed Review) asks for the one slug it's showing. Cached per
   * slug for the session: you pay for the startups you actually open, instead of for
   * every row in the table on every poll.
   */
  // Stable identity: callers put this in effect dependency arrays, and it only ever
  // touches refs.
  const hydrate = useCallback(async (slug: string | null | undefined) => {
    if (!slug || hydratedRef.current.has(slug)) return;
    hydratedRef.current.add(slug);
    try {
      const res = await fetch(`/api/startup/${slug}`);
      if (!res.ok) {
        hydratedRef.current.delete(slug);
        return;
      }
      const full = (await res.json()) as Partial<Startup>;
      const existing = mapRef.current.get(slug);
      if (!existing) return;
      mapRef.current.set(slug, { ...existing, ...full });
      setStartups(sortStartups(Array.from(mapRef.current.values())));
    } catch {
      hydratedRef.current.delete(slug);
    }
  }, []);

  /** Optimistically patch a row in local state, ahead of the network write. */
  function updateLocal(slug: string, partial: Partial<Startup>) {
    const existing = mapRef.current.get(slug);
    if (!existing) return;
    mapRef.current.set(slug, { ...existing, ...partial });
    commit();
  }

  useEffect(() => {
    const client = getBrowserClient();

    if (!client) {
      // Polling fallback
      setMode("polling");
      let active = true;
      const poll = async () => {
        // A hidden tab is nobody looking at a dashboard. Skipping those ticks is most
        // of the saving here — a backgrounded tab used to poll on forever.
        if (document.visibilityState !== "visible") return;
        const rows = await fetchList();
        if (active && rows) mergeRows(rows);
      };
      const id = setInterval(poll, POLL_INTERVAL_MS);
      // Catch up on refocus instead of making the user sit out the rest of an
      // interval they were away for.
      const onVisible = () => {
        if (document.visibilityState === "visible") poll();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        active = false;
        clearInterval(id);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    const channel = client
      .channel("startups-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "startups" },
        (payload) => {
          const row = payload.new as Startup | undefined;
          const old = payload.old as { slug?: string } | undefined;
          if (payload.eventType === "DELETE") {
            if (old?.slug) {
              mapRef.current.delete(old.slug);
              hydratedRef.current.delete(old.slug);
            }
          } else if (row?.slug) {
            const existing = mapRef.current.get(row.slug);
            mapRef.current.set(row.slug, existing ? { ...existing, ...row } : row);
          }
          commit();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setMode("realtime");
      });

    return () => {
      client.removeChannel(channel);
    };
  }, []);

  return { startups, mode, refresh, refreshing, updateLocal, hydrate };
}
