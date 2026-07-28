import { NextRequest, NextResponse } from "next/server";
import { supabase, DEALFLOW_STATUSES } from "../../../../lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Full row, deliberately: this is the one-slug-at-a-time counterpart to the list's
  // trimmed STARTUP_LIST_COLUMNS. One row of founders JSONB is nothing; the same
  // columns across the whole table on every poll was the problem. Callers are the
  // detail panel, Speed Review, and the enrichment poll — all single-startup views
  // that need everything.
  const { data, error } = await supabase
    .from("startups")
    .select("*")
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

/** Matches the CHECK constraint in scripts/migrate-followups.sql. */
const MAX_FOLLOWUP_COUNT = 99;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await req.json();
  const {
    status,
    stealth,
    linkedin_status,
    email_status,
    followup_count,
    last_followup_at,
  } = body;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (status !== undefined) {
    if (!DEALFLOW_STATUSES.includes(status)) {
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
  // The client sends the absolute count it wants, not "increment" — same optimistic
  // update + undo pattern as every other field here, and it means this route never
  // has to read the row first to know what to write.
  if (followup_count !== undefined) {
    if (
      typeof followup_count !== "number" ||
      !Number.isInteger(followup_count) ||
      followup_count < 0 ||
      followup_count > MAX_FOLLOWUP_COUNT
    ) {
      return NextResponse.json({ error: "invalid followup_count" }, { status: 400 });
    }
    update.followup_count = followup_count;
  }
  if (last_followup_at !== undefined) {
    if (last_followup_at !== null) {
      if (
        typeof last_followup_at !== "string" ||
        Number.isNaN(new Date(last_followup_at).getTime())
      ) {
        return NextResponse.json({ error: "invalid last_followup_at" }, { status: 400 });
      }
    }
    update.last_followup_at = last_followup_at;
  }

  const { error } = await supabase.from("startups").update(update).eq("slug", slug);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
