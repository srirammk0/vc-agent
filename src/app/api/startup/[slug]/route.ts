import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { updateSupermemoryStartupStatus } from "../../../../lib/supermemory";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const { data, error } = await supabase
    .from("startups")
    .select(
      "slug, enrichment_status, company_description, founders, stage, raised, location, founded, team_size"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { status } = await req.json();

  if (!["new", "approved", "passed"].includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const { error } = await supabase
    .from("startups")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("slug", slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also mirror into Supermemory so the agent's actual memory picks up the
  // change — without this, the agent never learns about a quick status change,
  // and the next periodic sync silently reverts it back to the old status.
  try {
    await updateSupermemoryStartupStatus(slug, status);
  } catch (e) {
    console.error("Supermemory status mirror failed:", e);
  }

  return NextResponse.json({ ok: true });
}
