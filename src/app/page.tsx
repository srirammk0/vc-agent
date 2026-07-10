import { supabase, type Startup } from "../lib/supabase";
import { sortStartups } from "../lib/sortStartups";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const { data: startups, error: startupsError } = await supabase
    .from("startups")
    .select("*");

  if (startupsError) {
    console.error(startupsError);
  }

  return (
    <main className="main-container">
      <Dashboard initial={sortStartups((startups ?? []) as Startup[])} />
    </main>
  );
}
