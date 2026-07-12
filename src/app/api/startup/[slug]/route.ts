import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";

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

const OUTREACH_CHANNEL_STATES = ["not_contacted", "contacted", "replied"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await req.json();
  const { status, stealth, linkedin_status, email_status } = body;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (status !== undefined) {
    if (!["new", "approved", "passed"].includes(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    update.status = status;
  }
  if (stealth !== undefined) {
    if (typeof stealth !== "boolean") {
      return NextResponse.json({ error: "invalid stealth" }, { status: 400 });
    }
    update.stealth = stealth;
  }
  if (linkedin_status !== undefined) {
    if (!OUTREACH_CHANNEL_STATES.includes(linkedin_status)) {
      return NextResponse.json({ error: "invalid linkedin_status" }, { status: 400 });
    }
    update.linkedin_status = linkedin_status;
  }
  if (email_status !== undefined) {
    if (!OUTREACH_CHANNEL_STATES.includes(email_status)) {
      return NextResponse.json({ error: "invalid email_status" }, { status: 400 });
    }
    update.email_status = email_status;
  }

  const { error } = await supabase.from("startups").update(update).eq("slug", slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
