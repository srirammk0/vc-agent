import { createClient } from "@supabase/supabase-js";

import { DEALFLOW_STATUSES, type DealflowStatus } from "./dealflowStatus";

export { DEALFLOW_STATUSES, type DealflowStatus };

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

export type WebAnalytics = {
  monthly_visits?: number;
  global_rank?: number;
  visit_growth_pct?: number;
  source?: "similarweb" | "fiber";
};

export type Competitor = {
  name?: string;
  domain?: string;
  monthly_visits?: number | null;
};

export type FiberMeta = {
  employee_count?: number;
  company_linkedin?: string;
};

export type Startup = {
  slug: string;
  name: string;
  website: string | null;
  one_liner: string | null;
  assessment: string | null;
  status: DealflowStatus;
  signal_urls: string[] | null;
  found_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  enrichment_status: "pending" | "running" | "complete" | "failed";
  enrichment_error: string | null;
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
  followup_count: number;
  last_followup_at: string | null;
  enriched: boolean;
  monthly_visits: number | null;
  global_rank: number | null;
  web_analytics: WebAnalytics | null;
  competitors: Competitor[] | null;
  fiber_meta: FiberMeta | null;
  has_email: boolean;
};

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
  "enrichment_error",
  "stealth",
  "linkedin_status",
  "email_status",
  "followup_count",
  "last_followup_at",
  "enriched",
  "monthly_visits",
  "has_email",
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
