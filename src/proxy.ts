import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // /api/* is deliberately NOT exempt anymore. Every route under it talks to
  // Supabase with the service-role key (bulk status writes, enrichment kickoff,
  // scheduled-task cancellation), so exempting it meant the whole mutable surface
  // of the app was reachable without a session — the login page only ever gated
  // the HTML. Note that api/chat.py is a separate Vercel Python function, not a
  // Next route, so this proxy never sees it; it verifies the same cookie itself.
  const authorized = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!authorized) {
    // API callers get a real 401 instead of a 307 to an HTML login page, so a
    // fetch() sees a status it can act on rather than parsing markup as JSON.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
