import { supabase, type Startup } from "../lib/supabase";
import { sortStartups } from "../lib/sortStartups";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data } = await supabase.from("startups").select("*");

  return <Dashboard initial={sortStartups((data ?? []) as Startup[])} />;
}
