import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type Founder = {
  name?: string;
  background?: string;
  linkedin?: string;
  twitter?: string;
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
  enrichment_status: "pending" | "running" | "complete";
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
};
