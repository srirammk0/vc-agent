"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "../../lib/supabaseBrowser";
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
      if (startup.enrichment_status !== "running") return;
      let active = true;
      const poll = async () => {
        try {
          const res = await fetch(`/api/startup/${startup.slug}`);
          if (!res.ok || !active) return;
          const json = await res.json();
          if (json.enrichment_status !== "running") {
            setStartup((prev) => ({ ...prev, ...json }));
          }
        } catch {
          // ignore
        }
      };
      const id = setInterval(poll, 2000);
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
