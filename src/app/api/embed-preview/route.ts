import { hostLabel, toHref } from "../../../lib/urls";

export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = ["linkedin.com"];

function isAllowedTarget(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function pickMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtml(m[1]);
  }
  return null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? decodeHtml(m[1].trim()) : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) {
    return new Response("Missing url", { status: 400 });
  }

  const target = toHref(raw);
  if (!isAllowedTarget(target)) {
    return new Response("URL not allowed", { status: 400 });
  }

  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; VCScout/1.0; +https://example.com) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      cache: "no-store",
    });

    const html = await res.text();
    const title =
      pickMeta(html, "og:title") ??
      pickMeta(html, "twitter:title") ??
      pickTitle(html) ??
      hostLabel(target);
    const description =
      pickMeta(html, "og:description") ??
      pickMeta(html, "description") ??
      pickMeta(html, "twitter:description") ??
      "";
    const image = pickMeta(html, "og:image") ?? pickMeta(html, "twitter:image");

    const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, "SF Pro Display", system-ui, sans-serif;
      background: #f9f9ef;
      color: #171717;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .hero {
      width: 100%;
      aspect-ratio: 1.91 / 1;
      max-height: 220px;
      background: linear-gradient(135deg, rgba(0,122,255,0.12), rgba(6,31,0,0.06));
      overflow: hidden;
    }
    .hero img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .body {
      padding: 18px 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
    }
    .kicker {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #6b6760;
    }
    h1 {
      font-size: 18px;
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: #061f00;
      font-weight: 600;
    }
    p {
      font-size: 13.5px;
      line-height: 1.5;
      color: #6b6760;
    }
    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: auto;
      height: 36px;
      padding: 0 14px;
      border-radius: 10px;
      background: #007aff;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="hero">${image ? `<img src="${escapeHtml(image)}" alt="" />` : ""}</div>
  <div class="body">
    <div class="kicker">LinkedIn</div>
    <h1>${escapeHtml(title)}</h1>
    ${description ? `<p>${escapeHtml(description)}</p>` : ""}
    <a href="${escapeHtml(target)}" target="_blank" rel="noreferrer">Open on LinkedIn</a>
  </div>
</body>
</html>`;

    return new Response(page, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch {
    return new Response("Preview failed", { status: 502 });
  }
}
