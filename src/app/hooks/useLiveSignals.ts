"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "../../lib/supabaseBrowser";

export type Signal = {
  id: string;
  source_url: string;
  title: string;
  snippet: string | null;
  platform: string;
  category: string;
  signal_type: string | null;
  score: number;
  favicon_url: string | null;
  ai_features: string[] | null;
  status: "new" | "sent" | "dismissed";
  scraped_at: string;
};

type Mode = "connecting" | "realtime" | "polling";

export function useLiveSignals(initial: Signal[]) {
  const [signals, setSignals] = useState<Signal[]>(initial);
  const [mode, setMode] = useState<Mode>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef<Map<string, Signal>>(
    new Map(initial.map((s) => [s.id, s]))
  );

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/signals");
      if (!res.ok) return;
      const { signals: rows } = await res.json();
      if (!Array.isArray(rows)) return;
      mapRef.current = new Map((rows as Signal[]).map((s) => [s.id, s]));
      commit();
    } catch {
      // ignore
    } finally {
      await new Promise((r) => setTimeout(r, 600));
      setRefreshing(false);
    }
  }

  function commit() {
    const list = Array.from(mapRef.current.values());
    list.sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime();
    });
    setSignals(list);
  }

  useEffect(() => {
    const client = getBrowserClient();

    if (!client) {
      setMode("polling");
      let active = true;
      const poll = async () => {
        try {
          const res = await fetch("/api/signals");
          if (!res.ok) return;
          const { signals: rows } = await res.json();
          if (!active || !Array.isArray(rows)) return;
          mapRef.current = new Map((rows as Signal[]).map((s) => [s.id, s]));
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
      .channel("signals-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "signals" },
        (payload) => {
          const row = payload.new as Signal | undefined;
          const old = payload.old as { id?: string } | undefined;
          if (payload.eventType === "DELETE") {
            if (old?.id) mapRef.current.delete(old.id);
          } else if (row?.id) {
            mapRef.current.set(row.id, row);
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

  return { signals, mode, refresh, refreshing };
}
