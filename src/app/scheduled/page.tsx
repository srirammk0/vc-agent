import { supabase, type ScheduledTask } from "../../lib/supabase";
import ScheduledRunsClient from "../components/ScheduledRunsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ScheduledRunsPage() {
  const { data, error } = await supabase
    .from("scheduled_tasks")
    .select("id, kind, due_at, payload, status, created_at")
    .order("due_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error(error);
  }

  return <ScheduledRunsClient initial={(data ?? []) as ScheduledTask[]} />;
}
