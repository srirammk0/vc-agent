import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { sortStartups } from "../../../lib/sortStartups";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase.from("startups").select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ startups: sortStartups(data ?? []) });
}

export async function PATCH(req: NextRequest) {
  const { slugs, status } = await req.json();

  if (!Array.isArray(slugs) || slugs.length === 0) {
    return NextResponse.json({ error: "slugs array required" }, { status: 400 });
  }

  if (!["new", "approved", "passed"].includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const { error } = await supabase
    .from("startups")
    .update({ status, updated_at: new Date().toISOString() })
    .in("slug", slugs);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

