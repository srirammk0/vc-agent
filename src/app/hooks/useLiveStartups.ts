"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "../../lib/supabaseBrowser";
import { sortStartups } from "../../lib/sortStartups";
import type { Startup } from "../../lib/supabase";

type Mode = "connecting" | "realtime" | "polling";

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

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/startups");
      if (!res.ok) return;
      const { startups: rows } = await res.json();
      if (!Array.isArray(rows)) return;
      mapRef.current = new Map(
        (rows as Startup[]).map((s) => [s.slug, s])
      );
      commit();
    } catch {
      // ignore
    } finally {
      await new Promise((r) => setTimeout(r, 600));
      setRefreshing(false);
    }
  }

  function commit() {
    setStartups(sortStartups(Array.from(mapRef.current.values())));
  }

  useEffect(() => {
    const client = getBrowserClient();

    if (!client) {
      // Polling fallback
      setMode("polling");
      let active = true;
      const poll = async () => {
        try {
          const res = await fetch("/api/startups");
          if (!res.ok) return;
          const { startups: rows } = await res.json();
          if (!active || !Array.isArray(rows)) return;
          mapRef.current = new Map(
            (rows as Startup[]).map((s) => [s.slug, s])
          );
          commit();
        } catch {
          // ignore
        }
      };
      const id = setInterval(poll, 4000);
      return () => {
        active = false;
        clearInterval(id);
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
            if (old?.slug) mapRef.current.delete(old.slug);
          } else if (row?.slug) {
            mapRef.current.set(row.slug, row);
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

  return { startups, mode, refresh, refreshing };
}
