/**
 * lib/dedup.ts
 *
 * Handles all read/write operations for the deduplication registry in the brain directory.
 *
 * Rules:
 * - A startup is "seen" if its URL or name matches any entry in brain/shortlist.md or brain/rejected.md.
 * - Saves passed startups as Markdown cards in brain/shortlist.md.
 * - Saves failed startups as pipe-delimited records in brain/rejected.md.
 * - Saves all seen URLs in brain/seen-urls.md.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ScoredStartup } from "./types.js";

const BRAIN_DIR = path.resolve(process.cwd(), "brain");
const SEEN_URLS_PATH = path.resolve(BRAIN_DIR, "seen-urls.md");
const SHORTLIST_PATH = path.resolve(BRAIN_DIR, "shortlist.md");
const REJECTED_PATH = path.resolve(BRAIN_DIR, "rejected.md");

/**
 * Reads brain data and returns a combined virtual registry string format: "url | name" per line.
 * Creates the brain files if they do not exist.
 */
export async function readRegistry(): Promise<string> {
  const entries: { url: string; name: string }[] = [];

  // Helper to ensure directory exists
  try {
    await fs.mkdir(BRAIN_DIR, { recursive: true });
  } catch (err) {}

  // 1. Read shortlist
  try {
    const shortlistContent = await fs.readFile(SHORTLIST_PATH, "utf-8");
    const blocks = shortlistContent.split("---").map(b => b.trim()).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split("\n");
      let name = "";
      let url = "";
      for (const line of lines) {
        if (line.startsWith("Name:")) {
          name = line.substring(5).trim();
        } else if (line.startsWith("URL:")) {
          url = line.substring(4).trim();
        }
      }
      if (name || url) {
        entries.push({ url, name });
      }
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.writeFile(SHORTLIST_PATH, "", "utf-8");
    }
  }

  // 2. Read rejected
  try {
    const rejectedContent = await fs.readFile(REJECTED_PATH, "utf-8");
    const lines = rejectedContent.split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split("|").map(p => p.trim());
      if (parts.length >= 2) {
        const url = parts[0];
        const name = parts[1];
        entries.push({ url, name });
      }
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.writeFile(REJECTED_PATH, "", "utf-8");
    }
  }

  // 3. Ensure seen-urls exists
  try {
    await fs.access(SEEN_URLS_PATH);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.writeFile(SEEN_URLS_PATH, "", "utf-8");
    }
  }

  return entries.map(e => `${e.url} | ${e.name}`).join("\n") + "\n";
}

/**
 * Returns true if the URL or name already exists in the virtual registry.
 */
export function isAlreadySeen(url: string, name: string, registry: string): boolean {
  const lines = registry.split("\n").map(l => l.trim()).filter(Boolean);
  const targetUrl = url.trim().toLowerCase().replace(/\/$/, "");
  const targetName = name.trim().toLowerCase();

  for (const line of lines) {
    const parts = line.split("|").map(p => p.trim());
    if (parts.length >= 2) {
      const lineUrl = parts[0].toLowerCase().replace(/\/$/, "");
      const lineName = parts[1].toLowerCase();
      if (targetUrl && lineUrl === targetUrl) {
        return true;
      }
      if (targetName && lineName === targetName) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Counts the number of seen startups in the registry.
 */
export function countRegistryEntries(registry: string): number {
  return registry.split("\n").map(l => l.trim()).filter(Boolean).length;
}

/**
 * Appends scored startups to the brain files: seen-urls, shortlist, and rejected.
 */
export async function appendToRegistry(startups: ScoredStartup[]): Promise<void> {
  if (startups.length === 0) return;

  const urlsToAppend: string[] = [];
  const shortlistEntries: string[] = [];
  const rejectedEntries: string[] = [];
  const today = new Date().toISOString();

  for (const s of startups) {
    if (s.url) {
      urlsToAppend.push(s.url);
    }
    if (s.pass) {
      const card = `---\nName: ${s.name}\nURL: ${s.url}\nScore: ${s.overall_score}\nOne-Liner: ${s.one_liner}\nWhy Interesting: ${s.why_interesting}\n---`;
      shortlistEntries.push(card);
    } else {
      const entry = `${s.url} | ${s.name} | ${s.overall_score} | failed scoring | ${today}`;
      rejectedEntries.push(entry);
    }
  }

  // Append to brain files
  if (urlsToAppend.length > 0) {
    await fs.appendFile(SEEN_URLS_PATH, urlsToAppend.join("\n") + "\n", "utf-8");
  }
  if (shortlistEntries.length > 0) {
    await fs.appendFile(SHORTLIST_PATH, shortlistEntries.join("\n\n") + "\n\n", "utf-8");
  }
  if (rejectedEntries.length > 0) {
    await fs.appendFile(REJECTED_PATH, rejectedEntries.join("\n") + "\n", "utf-8");
  }

  console.log(`[dedup] Appended ${startups.length} new entries to brain folder.`);
}

/**
 * Extracts a list of unique domain names from the registry to pass to Exa's excludeDomains.
 */
export function extractDomainsFromRegistry(registry: string): string[] {
  const lines = registry.split("\n").map(l => l.trim()).filter(Boolean);
  const domains = new Set<string>();
  
  for (const line of lines) {
    const parts = line.split("|").map(p => p.trim());
    const urlPart = parts[0];
    if (urlPart) {
      try {
        const toParse = urlPart.startsWith("http") ? urlPart : `http://${urlPart}`;
        const url = new URL(toParse);
        domains.add(url.hostname.replace(/^www\./, ""));
      } catch (e) {
        // Ignore invalid URLs
      }
    }
  }
  return Array.from(domains);
}

const CACHE_PATH = path.resolve(process.cwd(), "startup-cache.json");

export async function readCache(): Promise<ScoredStartup[]> {
  try {
    const contents = await fs.readFile(CACHE_PATH, "utf-8");
    return JSON.parse(contents);
  } catch (err: unknown) {
    return [];
  }
}

export async function writeCache(startups: ScoredStartup[]): Promise<void> {
  await fs.writeFile(CACHE_PATH, JSON.stringify(startups, null, 2), "utf-8");
}

export async function appendToCache(startups: ScoredStartup[]): Promise<void> {
  if (startups.length === 0) return;
  const current = await readCache();
  
  // Prevent duplicate entries in cache by URL
  const seenUrls = new Set(current.map(s => s.url.toLowerCase()));
  const newUnique = startups.filter(s => !seenUrls.has(s.url.toLowerCase()));
  
  if (newUnique.length === 0) return;
  
  await writeCache([...current, ...newUnique]);
}

export async function clearCache(): Promise<void> {
  await writeCache([]);
}

