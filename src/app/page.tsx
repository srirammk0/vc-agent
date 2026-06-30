import { supabase, type Startup } from "../lib/supabase";
import { sortStartups } from "../lib/sortStartups";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data } = await supabase
    .from("startups")
    .select("*")
    .order("found_date", { ascending: false });

  return <Dashboard initial={sortStartups((data ?? []) as Startup[])} />;
}
