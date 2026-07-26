"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "../../lib/supabaseBrowser";
import { isStaleRunning } from "../../lib/enrichment";
import type { Startup } from "../../lib/supabase";

/**
 * Single realtime subscription for one detail view (full page or panel).
 * Falls back to short polling only while enrichment is actively running and
 * no realtime client is configured — otherwise no network activity at all.
 */
export function useLiveStartup(initial: Startup) {
  const [startup, setStartup] = useState<Startup>(initial);

  useEffect(() => setStartup(initial), [initial.slug]);

  function updateLocal(partial: Partial<Startup>) {
    setStartup((prev) => ({ ...prev, ...partial }));
  }

  useEffect(() => {
    const client = getBrowserClient();

    if (!client) {
      // Stop polling once a "running" row is stale (stuck) too, not just when
      // it's no longer running — otherwise a job whose container got killed
      // mid-run would poll this endpoint forever with nothing ever changing.
      if (startup.enrichment_status !== "running" || isStaleRunning(startup)) return;
      let active = true;
      const poll = async () => {
        try {
          const res = await fetch(`/api/startup/${startup.slug}`);
          if (!res.ok || !active) return;
          const json = await res.json();
          if (json.enrichment_status !== "running" || isStaleRunning(json)) {
            setStartup((prev) => ({ ...prev, ...json }));
          }
        } catch {
          // ignore
        }
      };
      // 5s, not 2s: enrichment takes 10-30s, so 2s spent most ticks re-fetching a
      // row that hadn't changed. Only runs while a job is actually in flight.
      const id = setInterval(poll, 5000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }

    const channel = client
      .channel(`startup-${startup.slug}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "startups", filter: `slug=eq.${startup.slug}` },
        (payload) => setStartup((prev) => ({ ...prev, ...(payload.new as Partial<Startup>) }))
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [startup.slug, startup.enrichment_status]);

  return { startup, updateLocal };
}
