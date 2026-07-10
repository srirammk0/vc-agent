import https from "node:https";
import zlib from "node:zlib";
import { hostLabel, toHref } from "../../../lib/urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_HOSTS = ["linkedin.com"];
const USER_AGENT =
  "Mozilla/5.0 (compatible; VCScout/1.0; +https://example.com) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function isAllowedTarget(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function decompress(body: Buffer, encoding?: string): Buffer {
  switch (encoding) {
    case "gzip":
      return zlib.gunzipSync(body);
    case "br":
      return zlib.brotliDecompressSync(body);
    case "deflate":
      return zlib.inflateSync(body);
    default:
      return body;
  }
}

// Bypasses Next.js's dev-mode fetch instrumentation, which clones the response
// via `new Response(body, { status })` and throws a RangeError for LinkedIn's
// non-standard 999 bot-block status (outside the 200-599 range the Fetch spec allows).
function fetchHtml(url: string, redirectsLeft = 4): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "gzip, deflate, br",
        },
        timeout: 8000,
      },
      (res) => {
        const location = res.headers.location;
        if (
          location &&
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          redirectsLeft > 0
        ) {
          res.resume();
          fetchHtml(new URL(location, url).toString(), redirectsLeft - 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const body = decompress(Buffer.concat(chunks), res.headers["content-encoding"]);
            resolve(body.toString("utf-8"));
          } catch (err) {
            reject(err);
          }
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
  });
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
  const params = new URL(req.url).searchParams;
  const raw = params.get("url");
  if (!raw) {
    return new Response("Missing url", { status: 400 });
  }

  const target = toHref(raw);
  if (!isAllowedTarget(target)) {
    return new Response("URL not allowed", { status: 400 });
  }

  const fallbackLabel = params.get("label")?.trim();

  try {
    const html = await fetchHtml(target);
    const title =
      pickMeta(html, "og:title") ??
      pickMeta(html, "twitter:title") ??
      pickTitle(html) ??
      fallbackLabel ??
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
