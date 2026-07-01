import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .order("scraped_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ signals: data ?? [] });
}
