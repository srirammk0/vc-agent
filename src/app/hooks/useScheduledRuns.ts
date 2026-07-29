"use client";

import { useEffect, useRef, useState } from "react";
import type { ScheduledTask } from "../../lib/supabase";

// Was 15s. Scheduled runs fire on a minutes-to-days cadence, so a 15-second poll of
// up to 100 rows (each carrying a payload JSONB with the full run outcome text) was
// pure egress for no freshness anyone could perceive.
const POLL_INTERVAL_MS = 60000;

/**
 * Plain polling rather than Supabase realtime — scheduled_tasks isn't guaranteed to
 * be in the realtime publication the way startups is, and this feed doesn't need
 * sub-second freshness (runs fire on a minutes-to-days cadence).
 */
export function useScheduledRuns(initial: ScheduledTask[]) {
  const [tasks, setTasks] = useState<ScheduledTask[]>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadHint, setLoadHint] = useState<string | null>(null);
  const activeRef = useRef(true);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/scheduled-runs");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (activeRef.current) {
          setLoadError(data.error || `Failed to load (${res.status})`);
          setLoadHint(typeof data.hint === "string" ? data.hint : null);
        }
        return;
      }
      if (activeRef.current) {
        setLoadError(null);
        setLoadHint(null);
        if (Array.isArray(data.tasks)) setTasks(data.tasks);
      }
    } catch (e) {
      if (activeRef.current) {
        setLoadError(e instanceof Error ? e.message : "Failed to load scheduled runs");
        setLoadHint(null);
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    activeRef.current = true;
    // Don't poll into a hidden tab — see the same guard in useLiveStartups.
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = setInterval(tick, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      activeRef.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /** Optimistically removes the row; reverts and returns an error message on failure. */
  async function cancelTask(id: string): Promise<string | null> {
    const prev = tasks;
    setTasks((t) => t.filter((task) => task.id !== id));
    try {
      const res = await fetch(`/api/scheduled-runs/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTasks(prev);
        return data.error || "failed to cancel";
      }
      return null;
    } catch (e) {
      setTasks(prev);
      return e instanceof Error ? e.message : "failed to cancel";
    }
  }

  /** Rescheduling creates a new row server-side (no in-place edit), so this
   * refetches the full list on success rather than patching one row locally. */
  async function rescheduleTask(id: string, dueAtIso: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/scheduled-runs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ due_at: dueAtIso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return data.error || "failed to reschedule";
      }
      await refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "failed to reschedule";
    }
  }

  return { tasks, refresh, refreshing, loadError, loadHint, cancelTask, rescheduleTask };
}
