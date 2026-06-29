"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Browser Supabase client (anon key) for realtime subscriptions only.
 * Returns null if the public env vars aren't configured, so callers can
 * gracefully fall back to polling.
 */
export function getBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  if (_client) return _client;
  _client = createClient(url, anon, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return _client;
}
