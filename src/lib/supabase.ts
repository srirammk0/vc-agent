import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type FounderPosition = {
  company: string;
  title: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  description?: string;
};

export type Founder = {
  name?: string;
  background?: string;
  linkedin?: string;
  email?: string;
  twitter?: string;
  positions?: FounderPosition[];
  credibility_note?: string;
};

export type Startup = {
  slug: string;
  name: string;
  website: string | null;
  one_liner: string | null;
  assessment: string | null;
  status: "new" | "approved" | "passed";
  signal_urls: string[] | null;
  found_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  enrichment_status: "pending" | "running" | "complete" | "failed";
  company_description: string | null;
  founded: string | null;
  location: string | null;
  team_size: string | null;
  stage: string | null;
  raised: string | null;
  founders: Founder[] | null;
  stealth: boolean;
  linkedin_status: "not_contacted" | "contacted" | "replied";
  email_status: "not_contacted" | "contacted" | "replied";
  /** How many times we've chased this one after first contact (scripts/migrate-followups.sql). */
  followup_count: number;
  last_followup_at: string | null;
  /** Denormalized "has real enrichment data" flag so the list never has to pull the
   * founders JSONB just to decide whether to show a badge. See
   * scripts/migrate-egress-list-columns.sql. */
  enriched: boolean;
};

/**
 * Columns the dealflow list actually renders, filters, or sorts on.
 *
 * Deliberately NOT `*`: `founders` (tens of KB of JSONB on an enriched row),
 * `company_description` and `signal_urls` are never shown in the list, and pulling
 * them for every row on every render/poll was the bulk of this project's Supabase
 * egress. The full row is fetched one slug at a time, only when a startup is
 * actually opened (see /api/startup/[slug] and useLiveStartups' hydrate()).
 *
 * `assessment` stays because the list both renders a truncated version of it and
 * searches its full text client-side.
 */
export const STARTUP_LIST_COLUMNS = [
  "slug",
  "name",
  "website",
  "one_liner",
  "assessment",
  "status",
  "found_date",
  "created_at",
  "updated_at",
  "enrichment_status",
  "stealth",
  "linkedin_status",
  "email_status",
  "followup_count",
  "last_followup_at",
  "enriched",
].join(", ");

export type ScheduledTaskPayload = {
  instructions?: string;
  reason?: string;
  notes?: string;
  sender?: string;
  slug?: string;
  result?: string;
  _trigger_run_id?: string;
  _task_id?: string;
};

export type ScheduledTask = {
  id: string;
  kind: string;
  due_at: string;
  payload: ScheduledTaskPayload | null;
  status: "pending" | "done" | "cancelled";
  created_at: string | null;
};
