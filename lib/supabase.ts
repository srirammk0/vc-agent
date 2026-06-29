import { supabase } from "./supabaseClient";

export interface Startup {
  name: string;
  slug: string;
  one_liner: string;
  score: number;
  sources?: string[];
  founded?: string;
  team_size?: number;
  stage?: string;
  status: "new" | "approved" | "passed";
  enrichment_status: "pending" | "running" | "complete";
  website?: string;
  raised?: string;
  found?: string;
}

export interface RunRecord {
  ts: string;
  trigger: string;
  found: number;
  summary: string;
}

export async function loadBrain() {
  const startups: Record<string, Startup> = {};
  const runs: RunRecord[] = [];
  const notes: string[] = [];
  let updated = new Date().toISOString();

  try {
    // 1. Fetch startups
    const { data: startupData, error: sErr } = await supabase
      .from("startups")
      .select("*");
      
    if (sErr) throw sErr;
    
    if (startupData) {
      for (const row of startupData) {
        // Map V5 score object to total
        const score = typeof row.score === "object" && row.score !== null ? row.score.total : (row.score ?? 0);
        
        startups[row.slug] = {
          ...row,
          score,
        };
      }
    }

    // 2. Fetch runs
    const { data: runData, error: rErr } = await supabase
      .from("runs")
      .select("*")
      .order("id", { ascending: true });
      
    if (rErr) throw rErr;
    
    if (runData) {
      for (const row of runData) {
        runs.push({
          ts: row.ts,
          trigger: row.trigger,
          found: row.found,
          summary: row.summary,
        });
      }
    }

    // 3. Fetch notes
    const { data: noteData, error: nErr } = await supabase
      .from("memory_notes")
      .select("note")
      .order("id", { ascending: true });
      
    if (nErr) throw nErr;
    
    if (noteData) {
      for (const row of noteData) {
        notes.push(row.note);
      }
    }

    // Get latest update timestamp if startups exist
    const latestStartup = Object.values(startups).sort((a, b) => new Date(b.found || "").getTime() - new Date(a.found || "").getTime())[0];
    if (latestStartup && latestStartup.found) {
      updated = new Date(latestStartup.found).toISOString();
    }

  } catch (err) {
    console.error("Failed to load brain from Supabase:", err);
  }

  return {
    startups,
    runs,
    notes,
    updated,
  };
}
