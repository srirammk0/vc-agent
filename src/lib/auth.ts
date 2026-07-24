/**
 * Signed dashboard session cookie.
 *
 * The cookie used to be the literal string "ok", which meant anyone could grant
 * themselves a session by sending `Cookie: vc_auth=ok` — knowing the password was
 * never actually required. It's now an HMAC-SHA256 token over its own expiry, so a
 * valid cookie can only be produced by something holding DASHBOARD_SESSION_SECRET.
 *
 * Format: `v1.<unix-expiry>.<hex hmac of "v1.<unix-expiry>">`
 *
 * Built on Web Crypto rather than node:crypto so the exact same code runs in the
 * edge proxy (src/proxy.ts) and in server actions. api/chat.py verifies the same
 * token with Python's hmac — keep the two in sync if this format ever changes.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "vc_auth";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function requireSecret(): string {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret) {
    throw new Error("DASHBOARD_SESSION_SECRET is not set");
  }
  return secret;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-independent comparison — never short-circuits on the first differing byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionToken(now: number = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS;
  const body = `v1.${exp}`;
  return `${body}.${await sign(body)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const [, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return false;

  let expected: string;
  try {
    expected = await sign(`v1.${expRaw}`);
  } catch {
    // Secret missing/unusable — fail closed rather than letting anything through.
    return false;
  }
  return timingSafeEqual(sig, expected);
}

/**
 * Constant-time password check. Compares SHA-256 digests instead of the raw
 * strings so the comparison length can't leak the real password's length.
 */
export async function passwordMatches(candidate: unknown): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || typeof candidate !== "string" || !candidate) return false;
  const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
  return timingSafeEqual(a, b);
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
