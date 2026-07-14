"use client";

import { useEffect, useRef, useState } from "react";
import type { ScheduledTask } from "../../lib/supabase";

const POLL_INTERVAL_MS = 15000;

/**
 * Plain polling rather than Supabase realtime — scheduled_tasks isn't guaranteed to
 * be in the realtime publication the way startups is, and this feed doesn't need
 * sub-second freshness (runs fire on a minutes-to-days cadence).
 */
export function useScheduledRuns(initial: ScheduledTask[]) {
  const [tasks, setTasks] = useState<ScheduledTask[]>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const activeRef = useRef(true);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/scheduled-runs");
      if (!res.ok) return;
      const { tasks: rows } = await res.json();
      if (activeRef.current && Array.isArray(rows)) setTasks(rows);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    activeRef.current = true;
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      activeRef.current = false;
      clearInterval(id);
    };
  }, []);

  return { tasks, refresh, refreshing };
}
