import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { modalSecret } from "../../../lib/modalAuth";

export async function POST(req: NextRequest) {
  const { slug, name } = await req.json();

  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const secret = modalSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "DASHBOARD_SHARED_SECRET not configured" },
      { status: 500 }
    );
  }

  // updated_at anchors the dashboard's staleness check (src/lib/enrichment.ts) —
  // without it, a job whose container gets hard-killed before ever resetting
  // enrichment_status leaves the row stuck at "running" with no way to tell it
  // apart from one still genuinely in progress.
  await supabase
    .from("startups")
    .update({ enrichment_status: "running", updated_at: new Date().toISOString() })
    .eq("slug", slug);

  const modalUrl = process.env.MODAL_ENRICH_URL;
  if (!modalUrl) {
    return NextResponse.json(
      { error: "MODAL_ENRICH_URL not configured" },
      { status: 500 }
    );
  }

  try {
    await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name, secret }),
    });
  } catch (e) {
    // Never even reached Modal — a real failure, not "nothing found", so mark
    // it "failed" (not "pending") same as modal_app.py's own except block.
    await supabase
      .from("startups")
      .update({ enrichment_status: "failed" })
      .eq("slug", slug);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "enrich trigger failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
