export function toHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("//")) {
    return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  }
  return `https://${trimmed}`;
}

export function isLinkedInHost(url: string): boolean {
  try {
    const host = new URL(toHref(url)).hostname.replace(/^www\./, "");
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

export function hostLabel(url: string): string {
  try {
    return new URL(toHref(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
