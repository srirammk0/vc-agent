import { get, put } from "@vercel/blob";

// The agent's entire long-term memory lives in a single PRIVATE JSON document in
// Vercel Blob. One read at the start of a run, one write at the end. No database.

export interface Startup {
  slug: string;
  name: string;
  website: string;
  one_liner: string;
  founders: string;
  stage: string;
  raised: string;
  location: string;
  score: number;
  status: string; // new | reviewing | interested | passed | pitched
  signal: string; // where/why it was found
  found: string; // ISO date first seen
  updated: string; // ISO date last touched
}

export interface ConversationTurn {
  role: "user" | "agent";
  content: string;
  ts: string;
}

export interface RunRecord {
  ts: string;
  trigger: string;
  summary: string;
  found: number;
}

export interface Brain {
  startups: Record<string, Startup>;
  seen_urls: string[];
  notes: string[];
  conversation: ConversationTurn[];
  runs: RunRecord[];
  updated: string | null;
}

const BRAIN_KEY = "brain.json";

export function emptyBrain(): Brain {
  return {
    startups: {},
    seen_urls: [],
    notes: [],
    conversation: [],
    runs: [],
    updated: null,
  };
}

export async function loadBrain(): Promise<Brain> {
  try {
    const res = await get(BRAIN_KEY, { access: "private" });
    if (!res || res.statusCode !== 200) return emptyBrain();

    const data = (await new Response(res.stream).json()) as Partial<Brain>;
    return { ...emptyBrain(), ...data };
  } catch (err) {
    console.error("[blob] loadBrain failed, returning empty brain:", err);
    return emptyBrain();
  }
}

export async function saveBrain(brain: Brain): Promise<void> {
  brain.updated = new Date().toISOString();
  await put(BRAIN_KEY, JSON.stringify(brain, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}
