"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  passwordMatches,
} from "../../lib/auth";

export async function login(_prev: unknown, formData: FormData) {
  const password = formData.get("password");

  // The password used to be hardcoded here (and therefore in git history) and the
  // cookie it set was the constant "ok" — forgeable without ever seeing the
  // password. Both now come from env: DASHBOARD_PASSWORD to authenticate, and
  // DASHBOARD_SESSION_SECRET to sign a session token that actually proves it.
  if (!(await passwordMatches(password))) {
    return { error: "Incorrect password." };
  }

  let token: string;
  try {
    token = await createSessionToken();
  } catch {
    // No signing secret configured — refuse to issue a session rather than fall
    // back to something unverifiable.
    return { error: "Login is not configured. Set DASHBOARD_SESSION_SECRET." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  redirect("/");
}
