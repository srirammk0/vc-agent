import { supabase, STARTUP_LIST_COLUMNS, type Startup } from "../lib/supabase";
import { sortStartups } from "../lib/sortStartups";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  // .returns<Startup[]>(): see src/app/api/startups/route.ts's GET handler for why
  // this is needed (STARTUP_LIST_COLUMNS is a plain string, not a literal, so
  // supabase-js can't infer a row type from it on its own).
  const { data: startups, error: startupsError } = await supabase
    .from("startups")
    .select(STARTUP_LIST_COLUMNS)
    .returns<Startup[]>();

  if (startupsError) {
    console.error(startupsError);
  }

  return (
    <main className="main-container">
      <Dashboard initial={sortStartups(startups ?? [])} />
    </main>
  );
}
