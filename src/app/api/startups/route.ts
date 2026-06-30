import { NextResponse } from "next/server";
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
