import { supabase, type Startup } from "../lib/supabase";
import { sortStartups } from "../lib/sortStartups";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const [startupsRes, signalsRes] = await Promise.all([
    supabase
      .from("startups")
      .select("*"),
    supabase
      .from("signals")
      .select("*")
      .order("scraped_at", { ascending: false })
  ]);

  const startups = startupsRes.data;
  const signals = signalsRes.data;
  const startupsError = startupsRes.error;
  const signalsError = signalsRes.error;

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
