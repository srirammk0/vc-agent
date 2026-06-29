import { supabase } from "./supabaseClient";

export interface Startup {
  name: string;
  slug: string;
  one_liner: string;
  score: {
    total: number;
    [key: string]: any;
  };
  sources: string[];
  founded: string;
  team_size: number;
  stage: string;
  status: "new" | "approved" | "passed";
  enrichment_status: "pending" | "running" | "complete";
}

export async function syncBrainToBlob() {
  // Deprecated, no-op
}

export async function getLastAlertedStartup(): Promise<Startup | null> {
  try {
    const { data, error } = await supabase
      .from("startups")
      .select("*")
      .eq("status", "new")
      .limit(1);
      
    if (error) throw error;
    if (data && data.length > 0) {
      return data[0] as Startup;
    }
  } catch (e) {
    console.error("Failed to get last alerted startup from Supabase", e);
  }
  return null;
}

export async function updateStartupStatus(slug: string, status: "approved" | "passed") {
  try {
    const { error } = await supabase
      .from("startups")
      .update({ status })
      .eq("slug", slug);
      
    if (error) throw error;
  } catch (e) {
    console.error("Failed to update startup status", e);
  }
}
