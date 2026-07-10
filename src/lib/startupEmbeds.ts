import { isLinkedInHost, toHref } from "./urls";

export function websiteEmbedUrl(website?: string | null): string | null {
  if (!website?.trim()) return null;
  const href = toHref(website);
  if (isLinkedInHost(href)) return null;
  return href;
}
