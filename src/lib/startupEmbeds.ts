import type { Founder } from "./supabase";
import { isLinkedInHost, toHref } from "./urls";

export type LinkedInTarget = {
  label: string;
  url: string;
  kind: "company" | "founder";
};

/** Collect LinkedIn URLs from founders and optional company website field. */
export function collectLinkedInTargets(
  founders: Founder[] | null | undefined,
  website?: string | null
): LinkedInTarget[] {
  const seen = new Set<string>();
  const out: LinkedInTarget[] = [];

  function add(url: string | null | undefined, label: string, kind: LinkedInTarget["kind"]) {
    if (!url?.trim()) return;
    const href = toHref(url);
    if (!isLinkedInHost(href)) return;
    const key = href.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, url: href, kind });
  }

  add(website, "Company", "company");
  for (const f of founders ?? []) {
    add(f.linkedin, f.name?.trim() || "Founder", "founder");
  }
  return out;
}

export function websiteEmbedUrl(website?: string | null): string | null {
  if (!website?.trim()) return null;
  const href = toHref(website);
  if (isLinkedInHost(href)) return null;
  return href;
}
