import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { modalSecret } from "../../../lib/modalAuth";

export async function POST(req: NextRequest) {
  const { slug, name, status, message } = await req.json();

  if (!slug || typeof message !== "string" || !message.trim()) {
    return NextResponse.json(
      { error: "slug and message are required" },
      { status: 400 }
    );
  }

  const secret = modalSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "DASHBOARD_SHARED_SECRET not configured" },
      { status: 500 }
    );
  }

  const nextStatus =
    status === "approved" || status === "passed" || status === "new"
      ? status
      : null;

  if (nextStatus) {
    const { error } = await supabase
      .from("startups")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("slug", slug);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const modalUrl = process.env.MODAL_FEEDBACK_URL;
  if (!modalUrl) {
    return NextResponse.json(
      { error: "MODAL_FEEDBACK_URL not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        name: name || slug,
        status: nextStatus || "new",
        message: message.trim(),
        secret,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return NextResponse.json(
        { error: data.error || "feedback agent failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, reply: data.reply });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "feedback trigger failed" },
      { status: 500 }
    );
  }
}
