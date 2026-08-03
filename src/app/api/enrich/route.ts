import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { runScheduledCheck } from "../../../trigger/run-scheduled-check";

export async function POST(req: NextRequest) {
  const { slug, name } = await req.json();

  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  // updated_at anchors the dashboard's staleness check (src/lib/enrichment.ts) —
  // without it, a job whose task gets killed before ever resetting
  // enrichment_status leaves the row stuck at "running" with no way to tell it
  // apart from one still genuinely in progress.
  await supabase
    .from("startups")
    .update({ enrichment_status: "running", enrichment_error: null, updated_at: new Date().toISOString() })
    .eq("slug", slug);

  try {
    // Fire-and-forget: .trigger() enqueues the Trigger.dev run and returns
    // immediately, the actual research happens in agent/enrich_job.py. Authenticated
    // by the project's own Trigger.dev API key (server-side env var) — no shared
    // secret needed now that there's no separate compute platform to authenticate into.
    await runScheduledCheck.trigger({ mode: "enrich", slug, name });
  } catch (e) {
    // Never even reached Trigger.dev — a real failure, not "nothing found", so mark
    // it "failed" (not "pending") same as agent/enrich_job.py's own except block.
    await supabase
      .from("startups")
      .update({ enrichment_status: "failed", enrichment_error: e instanceof Error ? e.message : "enrich trigger failed" })
      .eq("slug", slug);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "enrich trigger failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
