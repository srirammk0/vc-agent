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
};

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
