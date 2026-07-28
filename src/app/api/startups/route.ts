import { NextRequest, NextResponse } from "next/server";
import { supabase, STARTUP_LIST_COLUMNS, DEALFLOW_STATUSES, type Startup } from "../../../lib/supabase";
import { sortStartups } from "../../../lib/sortStartups";

export const dynamic = "force-dynamic";

export async function GET() {
  // List columns only — see STARTUP_LIST_COLUMNS. This route is polled, so pulling
  // the founders JSONB here was the single biggest source of Supabase egress.
  // .returns<Startup[]>(): STARTUP_LIST_COLUMNS is a plain `string`, not a string
  // literal, so supabase-js can't statically parse it to infer a row type — without
  // this it types the result as a branded "couldn't parse this select" error type
  // instead. Startup itself is still a loose fit (the query omits founders/
  // company_description/etc.), same imprecision the rest of the list-vs-detail
  // split already accepts (see src/lib/enrichment.ts's hasEnrichmentData).
  const { data, error } = await supabase
    .from("startups")
    .select(STARTUP_LIST_COLUMNS)
    .returns<Startup[]>();

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

  if (!DEALFLOW_STATUSES.includes(status)) {
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

