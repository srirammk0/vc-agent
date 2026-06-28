import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const BRAIN_DIR = path.join(process.cwd(), "brain");

export async function readThesis(): Promise<string> {
  return readFile(path.join(BRAIN_DIR, "thesis.md"), "utf-8");
}

export async function readIndex(): Promise<string> {
  const p = path.join(BRAIN_DIR, "index.md");
  if (!existsSync(p)) return "No startups indexed yet.";
  return readFile(p, "utf-8");
}

export async function readStartup(slug: string): Promise<string | null> {
  const p = path.join(BRAIN_DIR, "startups", `${slug}.md`);
  if (!existsSync(p)) return null;
  return readFile(p, "utf-8");
}

export async function listStartupSlugs(): Promise<string[]> {
  const { readdir } = await import("fs/promises");
  const files = await readdir(path.join(BRAIN_DIR, "startups"));
  return files
    .filter((f) => f.endsWith(".md") && f !== "TEMPLATE.md")
    .map((f) => f.replace(".md", ""));
}

export async function updateStartupStatus(
  slug: string,
  status: "new" | "reviewing" | "interested" | "passed" | "pitched"
): Promise<void> {
  const p = path.join(BRAIN_DIR, "startups", `${slug}.md`);
  if (!existsSync(p)) throw new Error(`Startup not found: ${slug}`);
  const content = await readFile(p, "utf-8");
  const updated = content.replace(
    /\*\*Status:\*\* .+/,
    `**Status:** ${status}`
  );
  await writeFile(p, updated, "utf-8");
}
