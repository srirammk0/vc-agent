"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function login(_prev: unknown, formData: FormData) {
  const password = formData.get("password");

  if (password === "studiortf") {
    const store = await cookies();
    store.set("vc_auth", "ok", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    redirect("/");
  }

  return { error: "Incorrect password." };
}
