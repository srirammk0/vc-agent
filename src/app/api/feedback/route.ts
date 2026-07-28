import { NextRequest, NextResponse } from "next/server";
import { supabase, DEALFLOW_STATUSES } from "../../../lib/supabase";
import { runScheduledCheck } from "../../../trigger/run-scheduled-check";

export async function POST(req: NextRequest) {
  const { slug, name, status, message } = await req.json();

  if (!slug || typeof message !== "string" || !message.trim()) {
    return NextResponse.json(
      { error: "slug and message are required" },
      { status: 400 }
    );
  }

  const nextStatus =
    status && DEALFLOW_STATUSES.includes(status)
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

  try {
    // Fire-and-forget, same as /api/enrich: the status change above already
    // happened, and the dashboard never actually reads the agent's distilled reply
    // (StartupActions.tsx's sendFeedback only checks res.ok) — so there's nothing
    // worth blocking this request on. This just kicks off turning the reason into
    // a learned preference (agent.py's mode="feedback") in the background.
    await runScheduledCheck.trigger({
      mode: "feedback",
      slug,
      name: name || slug,
      status: nextStatus || "new",
      message: message.trim(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "feedback trigger failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
