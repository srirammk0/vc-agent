import { notFound } from "next/navigation";
import { supabase, type Startup } from "../../../lib/supabase";
import StartupDetailClient from "../../components/StartupDetailClient";

export const dynamic = "force-dynamic";

export default async function StartupDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const { data } = await supabase
    .from("startups")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) notFound();

  return <StartupDetailClient initial={data as Startup} />;
}
