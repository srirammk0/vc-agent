import { put, head, list } from "@vercel/blob";

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

export async function uploadToBlob(filePath: string, buffer: Buffer): Promise<void> {
  const blobPath = filePath;
  await put(blobPath, buffer, {
    access: "public",
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function downloadFromBlob(blobPath: string): Promise<Buffer | null> {
  try {
    const details = await head(blobPath, { token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!details) return null;
    
    const res = await fetch(details.downloadUrl);
    if (!res.ok) return null;
    
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error(`[blob] failed to download ${blobPath}:`, err);
    return null;
  }
}

export async function loadBrain() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const startups: Record<string, Startup> = {};
  const runs: RunRecord[] = [];
  const notes: string[] = [];
  let updated = new Date().toISOString();

  try {
    const { blobs } = await list({ token });
    
    // Fetch startups
    const startupBlobs = blobs.filter(b => b.pathname.startsWith("brain/startups/") && b.pathname.endsWith(".md"));
    
    await Promise.all(startupBlobs.map(async (blob) => {
      try {
        const res = await fetch(blob.downloadUrl);
        if (!res.ok) return;
        const text = await res.text();
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          const raw = JSON.parse(jsonMatch[1]);
          // Map V5 score object to V4 score number for dashboard compatibility
          const score = typeof raw.score === "object" && raw.score !== null ? raw.score.total : (raw.score ?? 0);
          
          startups[raw.slug] = {
            ...raw,
            score,
          };
        }
      } catch (e) {
        console.error("Failed to parse startup blob", blob.pathname, e);
      }
    }));
    
  } catch (err) {
    console.error("Failed to load brain from blob", err);
  }

  return {
    startups,
    runs,
    notes,
    updated,
  };
}
