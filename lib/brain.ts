import fs from "fs";
import path from "path";
import { uploadToBlob, downloadFromBlob } from "./blob";

const BRAIN_DIR = path.join(process.cwd(), "brain");

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
  // Sync the entire brain directory to Vercel Blob
  const syncDir = async (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath);
      
      if (entry.isDirectory()) {
        await syncDir(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".md")) {
        const buffer = fs.readFileSync(fullPath);
        await uploadToBlob(relativePath, buffer);
      }
    }
  };
  
  if (fs.existsSync(BRAIN_DIR)) {
    await syncDir(BRAIN_DIR);
  }
}

export function getLastAlertedStartup(): Startup | null {
  // Mock logic to get the most recently found pending startup
  // In a real scenario, you parse brain/index.md or the startups directory
  const startupsDir = path.join(BRAIN_DIR, "startups");
  if (!fs.existsSync(startupsDir)) return null;
  
  const files = fs.readdirSync(startupsDir).filter(f => f.endsWith(".md"));
  if (files.length === 0) return null;
  
  // Just return the first one that is "new" for this example
  for (const file of files) {
    const content = fs.readFileSync(path.join(startupsDir, file), "utf-8");
    try {
      const jsonStr = content.split("```json")[1].split("```")[0].trim();
      const startup = JSON.parse(jsonStr) as Startup;
      if (startup.status === "new") {
        return startup;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  return null;
}

export async function updateStartupStatus(slug: string, status: "approved" | "passed") {
  const filePath = path.join(BRAIN_DIR, "startups", `${slug}.md`);
  if (!fs.existsSync(filePath)) return;
  
  const content = fs.readFileSync(filePath, "utf-8");
  try {
    const jsonStr = content.split("```json")[1].split("```")[0].trim();
    const startup = JSON.parse(jsonStr);
    startup.status = status;
    
    const newContent = `# ${startup.name}\n\n\`\`\`json\n${JSON.stringify(startup, null, 2)}\n\`\`\`\n`;
    fs.writeFileSync(filePath, newContent);
    
    // Sync to blob
    const buffer = fs.readFileSync(filePath);
    await uploadToBlob(`brain/startups/${slug}.md`, buffer);
  } catch (e) {
    console.error("Failed to update startup status", e);
  }
}
