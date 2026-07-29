import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("scheduled_tasks")
    .select("id, kind, due_at, payload, status, created_at")
    .order("due_at", { ascending: false })
    .limit(100);

  if (error) {
    const hint =
      error.message.includes("scheduled_tasks") || error.code === "42P01"
        ? "Run scripts/migrate-scheduled-tasks.sql in the Supabase SQL editor."
        : undefined;
    return NextResponse.json({ error: error.message, hint, tasks: [] }, { status: 500 });
  }

  return NextResponse.json({ tasks: data ?? [] });
}
