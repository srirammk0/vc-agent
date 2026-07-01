import { supabase, type Startup } from "../lib/supabase";
import { sortStartups } from "../lib/sortStartups";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const { data: startups, error: startupsError } = await supabase
    .from("startups")
    .select("*")
    .order("created_at", { ascending: false });
    
  const { data: signals, error: signalsError } = await supabase
    .from("signals")
    .select("*")
    .order("scraped_at", { ascending: false });

  if (startupsError) {
    console.error(startupsError);
  }
  if (signalsError) {
    console.error(signalsError);
  }

  return (
    <main className="main-container">
      <Dashboard initial={sortStartups((startups ?? []) as Startup[])} initialSignals={signals ?? []} />
    </main>
  );
}
